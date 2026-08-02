import type { PrismaClient } from '@prisma/client'

import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { buildPartnerPortalToken, hashPartnerPortalToken, normalizePartnerPortalEmail, PartnerPortalCredentialValidationError } from './partnerPortalCredentials'
import { PartnerPortalPasswordService, PartnerPortalPasswordValidationError } from './PartnerPortalPasswordService'
import { PartnerPortalSession, PartnerPortalSessionService } from './PartnerPortalSessionService'
import { PartnerPortalSignupChallenge, PartnerPortalSignupProtectionService } from './PartnerPortalSignupProtectionService'
import { PartnerPortalEmailDeliveryError, ResendPartnerPortalEmailSender } from './ResendPartnerPortalEmailSender'

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000
const MAX_COMPANY_LENGTH = 160
const MAX_COUNTRY_LENGTH = 64
const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const MAX_NAME_LENGTH = 100
const MAX_SERIALIZATION_ATTEMPTS = 3
const MIN_IDEMPOTENCY_KEY_LENGTH = 16
const RESEND_COOLDOWN_MS = 60 * 1_000
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/
const ORGANIZATION_SEPARATOR = '\u001f'

type NormalizedSignupInput = {
  company: string
  country: string
  email: string
  firstName: string
  idempotencyKey: string
  lastName: string
  password: string
}

type VerificationEmailDispatch = {
  email: string
  firstName: string
  plaintextToken: string
  tokenId: string
}

const portalUserForVerification = {
  partner: true,
} satisfies Prisma.PartnerPortalUserInclude

export type PartnerPortalPublicSignupInput = {
  challengeToken: string
  clientIp: string
  company: string
  country: string
  email: string
  firstName: string
  honeypot: string
  idempotencyKey: string
  lastName: string
  password: string
}

export type PartnerPortalSignupAcknowledgement = {
  status: 'VERIFICATION_REQUIRED'
}

export class PartnerPortalEmailVerificationError extends Error {
  public constructor() {
    super('Verification link is invalid or expired')
    this.name = 'PartnerPortalEmailVerificationError'
  }
}

export class PartnerPortalSignupValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalSignupValidationError'
  }
}

@injectable()
export class PartnerPortalSignupService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
    @inject(PartnerPortalPasswordService)
    private readonly passwordService: PartnerPortalPasswordService,
    @inject(PartnerPortalSignupProtectionService)
    private readonly protectionService: PartnerPortalSignupProtectionService,
    @inject(ResendPartnerPortalEmailSender)
    private readonly emailSender: ResendPartnerPortalEmailSender,
    @inject(PartnerPortalSessionService)
    private readonly sessionService: PartnerPortalSessionService,
  ) {}

  public createChallenge(clientIp: string): Promise<PartnerPortalSignupChallenge> {
    return this.protectionService.createChallenge(clientIp)
  }

  public async signup(
    input: PartnerPortalPublicSignupInput,
  ): Promise<PartnerPortalSignupAcknowledgement> {
    const normalized = this.normalizeSignupInput(input)
    const organizationKey = this.canonicalizeOrganization(
      normalized.company,
      normalized.country,
    )
    await this.protectionService.assertSignupAllowed({
      challengeToken: input.challengeToken,
      clientIp: input.clientIp,
      email: normalized.email,
      honeypot: input.honeypot,
      organization: organizationKey,
    })
    const [idempotencyHash, organizationHash] = await Promise.all([
      this.protectionService.hashIdentifier('idempotency', normalized.idempotencyKey),
      this.protectionService.hashIdentifier('organization', organizationKey),
    ])
    const prismaClient = await this.databaseClientProvider.getClient()

    const existingPartner = await prismaClient.partner.findUnique({
      where: { publicSignupIdempotencyHash: idempotencyHash },
    })
    if (existingPartner) {
      const dispatch = await this.prepareReplayDelivery(
        prismaClient,
        existingPartner,
        normalized,
      )
      await this.deliverVerificationEmail(dispatch)
      return { status: 'VERIFICATION_REQUIRED' }
    }

    let passwordVerifier: string
    try {
      passwordVerifier = await this.passwordService.buildVerifier(normalized.password)
    }
    catch (error) {
      if (error instanceof PartnerPortalPasswordValidationError) {
        throw new PartnerPortalSignupValidationError(error.message)
      }
      throw error
    }

    const token = buildPartnerPortalToken()
    const now = new Date()
    let dispatch: null | VerificationEmailDispatch = null
    try {
      dispatch = await this.executeSerializable(prismaClient, async (transaction) => {
        const partner = await transaction.partner.create({
          data: {
            country: normalized.country,
            email: normalized.email,
            firstName: normalized.firstName,
            lastName: normalized.lastName,
            name: normalized.company,
            publicSignupIdempotencyHash: idempotencyHash,
            publicSignupOrganizationHash: organizationHash,
          },
        })
        const portalUser = await transaction.partnerPortalUser.create({
          data: {
            email: normalized.email,
            emailVerificationRequiredAt: now,
            partnerId: partner.id,
            passwordVerifier,
            role: 'ADMIN',
          },
        })
        const verificationToken = await transaction.partnerPortalEmailVerificationToken.create({
          data: {
            expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
            tokenHash: token.tokenHash,
            userId: portalUser.id,
          },
        })
        await this.auditService.record({
          action: 'signup.created',
          partnerId: partner.id,
          resourceId: portalUser.id,
          resourceType: 'partner_portal_user',
        }, transaction)
        return {
          email: normalized.email,
          firstName: normalized.firstName,
          plaintextToken: token.plaintext,
          tokenId: verificationToken.id,
        }
      })
    }
    catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error
      }
      const racedPartner = await prismaClient.partner.findUnique({
        where: { publicSignupIdempotencyHash: idempotencyHash },
      })
      if (racedPartner) {
        dispatch = await this.prepareReplayDelivery(prismaClient, racedPartner, normalized)
      }
      else {
        const recoverablePartner = await prismaClient.partner.findFirst({
          where: {
            email: normalized.email,
            publicSignupOrganizationHash: organizationHash,
          },
        })
        if (recoverablePartner) {
          dispatch = await this.prepareReplayDelivery(
            prismaClient,
            recoverablePartner,
            normalized,
          )
        }
      }
    }

    await this.deliverVerificationEmail(dispatch)
    return { status: 'VERIFICATION_REQUIRED' }
  }

  public async verifyEmail(clientIp: string, plaintextToken: string): Promise<PartnerPortalSession> {
    await this.protectionService.consumeEmailVerificationAttempt(clientIp)
    let tokenHash: string
    try {
      tokenHash = hashPartnerPortalToken(plaintextToken)
    }
    catch {
      throw new PartnerPortalEmailVerificationError()
    }

    const now = new Date()
    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      const portalUser = await this.executeSerializable(prismaClient, async (transaction) => {
        const verificationToken = await transaction.partnerPortalEmailVerificationToken.findUnique({
          include: {
            user: { include: portalUserForVerification },
          },
          where: { tokenHash },
        })
        if (
          !verificationToken
          || verificationToken.consumedAt
          || verificationToken.expiresAt <= now
          || verificationToken.user.disabledAt
          || verificationToken.user.passwordVerifier === null
          || !verificationToken.user.emailVerificationRequiredAt
          || verificationToken.user.emailVerifiedAt
        ) {
          throw new PartnerPortalEmailVerificationError()
        }

        const consumed = await transaction.partnerPortalEmailVerificationToken.updateMany({
          data: { consumedAt: now },
          where: {
            consumedAt: null,
            expiresAt: { gt: now },
            id: verificationToken.id,
          },
        })
        if (consumed.count !== 1) {
          throw new PartnerPortalEmailVerificationError()
        }
        const verifiedUser = await transaction.partnerPortalUser.update({
          data: { emailVerifiedAt: now },
          include: portalUserForVerification,
          where: { id: verificationToken.userId },
        })
        await this.auditService.record({
          action: 'signup.email_verified',
          actorUserId: verifiedUser.id,
          partnerId: verifiedUser.partnerId,
          resourceId: verifiedUser.id,
          resourceType: 'partner_portal_user',
        }, transaction)
        return verifiedUser
      })
      return await this.sessionService.createSession(portalUser)
    }
    catch (error) {
      if (error instanceof PartnerPortalEmailVerificationError) {
        throw error
      }
      if (this.isSerializationError(error)) {
        throw new PartnerPortalEmailVerificationError()
      }
      throw error
    }
  }

  private canonicalizeOrganization(company: string, country: string): string {
    const canonicalCompany = company
      .toLocaleLowerCase('en-US')
      .replace(/[\p{P}\p{S}\s]+/gu, '')
    if (canonicalCompany.length === 0) {
      throw new PartnerPortalSignupValidationError('Company name is invalid')
    }
    return `${canonicalCompany}${ORGANIZATION_SEPARATOR}${country.toLocaleLowerCase('en-US')}`
  }

  private async deliverVerificationEmail(
    dispatch: null | VerificationEmailDispatch,
  ): Promise<void> {
    if (!dispatch) {
      return
    }
    try {
      const result = await this.emailSender.sendVerificationEmail(dispatch)
      try {
        const prismaClient = await this.databaseClientProvider.getClient()
        await prismaClient.partnerPortalEmailVerificationToken.updateMany({
          data: {
            providerMessageId: result.providerMessageId,
            sentAt: new Date(),
          },
          where: {
            consumedAt: null,
            id: dispatch.tokenId,
          },
        })
      }
      catch {
        this.logger.error('Partner signup email delivery metadata could not be persisted')
      }
    }
    catch (error) {
      this.logger.warn('Partner signup verification email delivery failed', {
        code: error instanceof PartnerPortalEmailDeliveryError ? error.code : 'UNEXPECTED',
      })
    }
  }

  private async executeSerializable<TResult>(
    prismaClient: PrismaClient,
    operation: (transaction: Prisma.TransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    for (let attempt = 1; attempt <= MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        return await prismaClient.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
      }
      catch (error) {
        if (!this.isSerializationError(error) || attempt === MAX_SERIALIZATION_ATTEMPTS) {
          throw error
        }
      }
    }
    throw new Error('Serializable partner signup operation did not complete')
  }

  private isExactReplay(
    partner: {
      country: null | string
      email: null | string
      firstName: null | string
      lastName: null | string
      name: string
    },
    input: NormalizedSignupInput,
  ): boolean {
    return (
      partner.name === input.company
      && partner.country === input.country
      && partner.email === input.email
      && partner.firstName === input.firstName
      && partner.lastName === input.lastName
    )
  }

  private isSerializationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private normalizeIdempotencyKey(value: string): string {
    const normalized = value.trim()
    if (
      normalized.length < MIN_IDEMPOTENCY_KEY_LENGTH
      || normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH
      || !IDEMPOTENCY_KEY_PATTERN.test(normalized)
    ) {
      throw new PartnerPortalSignupValidationError('Signup request is invalid')
    }
    return normalized
  }

  private normalizeSignupInput(input: PartnerPortalPublicSignupInput): NormalizedSignupInput {
    let email: string
    try {
      email = normalizePartnerPortalEmail(input.email)
    }
    catch (error) {
      if (error instanceof PartnerPortalCredentialValidationError) {
        throw new PartnerPortalSignupValidationError(error.message)
      }
      throw error
    }
    return {
      company: this.normalizeText(input.company, 'Company name', MAX_COMPANY_LENGTH),
      country: this.normalizeText(input.country, 'Country', MAX_COUNTRY_LENGTH).toUpperCase(),
      email,
      firstName: this.normalizeText(input.firstName, 'First name', MAX_NAME_LENGTH),
      idempotencyKey: this.normalizeIdempotencyKey(input.idempotencyKey),
      lastName: this.normalizeText(input.lastName, 'Last name', MAX_NAME_LENGTH),
      password: input.password,
    }
  }

  private normalizeText(value: string, label: string, maximumLength: number): string {
    const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    if (
      normalized.length === 0
      || normalized.length > maximumLength
      || CONTROL_CHARACTER_PATTERN.test(normalized)
    ) {
      throw new PartnerPortalSignupValidationError(`${label} is invalid`)
    }
    return normalized
  }

  private async prepareReplayDelivery(
    prismaClient: PrismaClient,
    partner: {
      country: null | string
      email: null | string
      firstName: null | string
      id: string
      lastName: null | string
      name: string
    },
    input: NormalizedSignupInput,
  ): Promise<null | VerificationEmailDispatch> {
    if (!this.isExactReplay(partner, input)) {
      await this.passwordService.performDummyVerification(input.password)
      return null
    }
    const portalUser = await prismaClient.partnerPortalUser.findUnique({
      where: { email: input.email },
    })
    if (!portalUser || portalUser.partnerId !== partner.id || portalUser.passwordVerifier === null) {
      await this.passwordService.performDummyVerification(input.password)
      return null
    }
    const passwordMatches = await this.passwordService.verify(
      input.password,
      portalUser.passwordVerifier,
    )
    if (
      !passwordMatches
      || portalUser.disabledAt
      || !portalUser.emailVerificationRequiredAt
      || portalUser.emailVerifiedAt
    ) {
      return null
    }

    const now = new Date()
    const recentToken = await prismaClient.partnerPortalEmailVerificationToken.findFirst({
      orderBy: { createdAt: 'desc' },
      where: {
        consumedAt: null,
        createdAt: { gte: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
        userId: portalUser.id,
      },
    })
    if (recentToken) {
      return null
    }

    const token = buildPartnerPortalToken()
    const verificationToken = await this.executeSerializable(prismaClient, async (transaction) => {
      const currentPortalUser = await transaction.partnerPortalUser.findUnique({
        where: { id: portalUser.id },
      })
      if (
        !currentPortalUser
        || currentPortalUser.disabledAt
        || !currentPortalUser.emailVerificationRequiredAt
        || currentPortalUser.emailVerifiedAt
        || currentPortalUser.passwordVerifier !== portalUser.passwordVerifier
      ) {
        return null
      }
      const racedRecentToken = await transaction.partnerPortalEmailVerificationToken.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          consumedAt: null,
          createdAt: { gte: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
          userId: portalUser.id,
        },
      })
      if (racedRecentToken) {
        return null
      }
      await transaction.partnerPortalEmailVerificationToken.updateMany({
        data: { expiresAt: now },
        where: {
          consumedAt: null,
          expiresAt: { gt: now },
          userId: portalUser.id,
        },
      })
      const createdToken = await transaction.partnerPortalEmailVerificationToken.create({
        data: {
          expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
          tokenHash: token.tokenHash,
          userId: portalUser.id,
        },
      })
      await this.auditService.record({
        action: 'signup.verification_email_requested',
        partnerId: partner.id,
        resourceId: portalUser.id,
        resourceType: 'partner_portal_user',
      }, transaction)
      return createdToken
    })
    return verificationToken
      ? {
          email: input.email,
          firstName: input.firstName,
          plaintextToken: token.plaintext,
          tokenId: verificationToken.id,
        }
      : null
  }
}
