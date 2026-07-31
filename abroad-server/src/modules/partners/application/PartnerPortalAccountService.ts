import type { PartnerPortalUser } from '@prisma/client'

import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalPasswordService, PartnerPortalPasswordValidationError } from './PartnerPortalPasswordService'
import { PartnerPortalSession, PartnerPortalSessionService } from './PartnerPortalSessionService'

const MAX_FAILED_LOGIN_ATTEMPTS = 5
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 254

const portalUserWithPartner = {
  partner: true,
} satisfies Prisma.PartnerPortalUserInclude

export type PartnerPortalCredentials = {
  email: string
  password: string
}

export type PartnerPortalUserProvisioningResult = {
  created: boolean
  email: string
  id: string
  partnerId: string
}

export class PartnerPortalAccountNotFoundError extends Error {
  public constructor() {
    super('Partner not found')
    this.name = 'PartnerPortalAccountNotFoundError'
  }
}

export class PartnerPortalAccountValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalAccountValidationError'
  }
}

export class PartnerPortalAuthenticationError extends Error {
  public constructor() {
    super('Email or password is incorrect')
    this.name = 'PartnerPortalAuthenticationError'
  }
}

@injectable()
export class PartnerPortalAccountService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalPasswordService)
    private readonly passwordService: PartnerPortalPasswordService,
    @inject(PartnerPortalSessionService)
    private readonly sessionService: PartnerPortalSessionService,
  ) {}

  public async authenticate(credentials: PartnerPortalCredentials): Promise<PartnerPortalSession> {
    const email = this.normalizeEmail(credentials.email)
    const prismaClient = await this.databaseClientProvider.getClient()
    const portalUser = await prismaClient.partnerPortalUser.findUnique({
      include: portalUserWithPartner,
      where: { email },
    })

    if (!portalUser) {
      await this.passwordService.performDummyVerification(credentials.password)
      throw new PartnerPortalAuthenticationError()
    }

    const passwordMatches = await this.passwordService.verify(
      credentials.password,
      portalUser.passwordVerifier,
    )
    const now = new Date()
    if (portalUser.disabledAt || this.isLocked(portalUser, now)) {
      throw new PartnerPortalAuthenticationError()
    }
    if (!passwordMatches) {
      await this.recordFailedLogin(portalUser, now)
      throw new PartnerPortalAuthenticationError()
    }

    const authenticatedUser = await prismaClient.partnerPortalUser.update({
      data: {
        failedLoginAttempts: 0,
        lastLoginAt: now,
        lockedUntil: null,
      },
      include: portalUserWithPartner,
      where: { id: portalUser.id },
    })
    return this.sessionService.createSession(authenticatedUser)
  }

  public async provision(
    partnerId: string,
    credentials: PartnerPortalCredentials,
  ): Promise<PartnerPortalUserProvisioningResult> {
    const email = this.normalizeEmail(credentials.email)
    let passwordVerifier: string
    try {
      passwordVerifier = await this.passwordService.buildVerifier(credentials.password)
    }
    catch (error) {
      if (error instanceof PartnerPortalPasswordValidationError) {
        throw new PartnerPortalAccountValidationError(error.message)
      }
      throw error
    }

    const prismaClient = await this.databaseClientProvider.getClient()
    const partner = await prismaClient.partner.findUnique({ where: { id: partnerId } })
    if (!partner) {
      throw new PartnerPortalAccountNotFoundError()
    }

    const existingUser = await prismaClient.partnerPortalUser.findUnique({ where: { email } })
    if (existingUser && existingUser.partnerId !== partnerId) {
      throw new PartnerPortalAccountValidationError('Portal email is already assigned')
    }

    try {
      const portalUser = existingUser
        ? await prismaClient.partnerPortalUser.update({
            data: {
              disabledAt: null,
              failedLoginAttempts: 0,
              lockedUntil: null,
              passwordVerifier,
              sessionVersion: { increment: 1 },
            },
            where: { id: existingUser.id },
          })
        : await prismaClient.partnerPortalUser.create({
            data: {
              email,
              partnerId,
              passwordVerifier,
            },
          })

      return this.toProvisioningResult(portalUser, !existingUser)
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new PartnerPortalAccountValidationError('Portal email is already assigned')
      }
      throw error
    }
  }

  private isLocked(portalUser: PartnerPortalUser, now: Date): boolean {
    return Boolean(portalUser.lockedUntil && portalUser.lockedUntil > now)
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    )
  }

  private normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase()
    if (
      normalized.length === 0
      || normalized.length > MAX_EMAIL_LENGTH
      || !EMAIL_PATTERN.test(normalized)
    ) {
      throw new PartnerPortalAccountValidationError('Email is invalid')
    }
    return normalized
  }

  private async recordFailedLogin(portalUser: PartnerPortalUser, now: Date): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    if (portalUser.lockedUntil && portalUser.lockedUntil <= now) {
      await prismaClient.partnerPortalUser.updateMany({
        data: { failedLoginAttempts: 0, lockedUntil: null },
        where: {
          id: portalUser.id,
          lockedUntil: { lte: now },
        },
      })
    }

    const failedLoginState = await prismaClient.partnerPortalUser.update({
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
      where: { id: portalUser.id },
    })
    if (failedLoginState.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await prismaClient.partnerPortalUser.update({
        data: { lockedUntil: new Date(now.getTime() + LOGIN_LOCK_DURATION_MS) },
        where: { id: portalUser.id },
      })
    }
  }

  private toProvisioningResult(
    portalUser: PartnerPortalUser,
    created: boolean,
  ): PartnerPortalUserProvisioningResult {
    return {
      created,
      email: portalUser.email,
      id: portalUser.id,
      partnerId: portalUser.partnerId,
    }
  }
}
