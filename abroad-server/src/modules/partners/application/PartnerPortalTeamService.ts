import { PartnerPortalPasswordResetPurpose, PartnerPortalRole, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { buildPartnerPortalToken, normalizePartnerPortalEmail, PartnerPortalCredentialValidationError } from './partnerPortalCredentials'
import { PartnerPortalPrincipal } from './PartnerPortalSessionService'

const INVITATION_TTL_MS = 24 * 60 * 60 * 1_000
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1_000

export type PartnerPortalAuditEventDto = {
  action: string
  actorEmail: null | string
  createdAt: Date
  id: string
  resourceId: null | string
  resourceType: string
}

export type PartnerPortalResetTokenResult = {
  expiresAt: Date
  purpose: PartnerPortalPasswordResetPurpose
  token: string
  user: PartnerPortalUserSummary
}

export type PartnerPortalTeamUpdateInput = {
  disabled?: boolean
  role?: PartnerPortalRole
}

export type PartnerPortalUserCreateInput = {
  email: string
  role: PartnerPortalRole
}

export type PartnerPortalUserSummary = {
  createdAt: Date
  disabledAt: Date | null
  email: string
  id: string
  lastLoginAt: Date | null
  mfaEnabled: boolean
  role: PartnerPortalRole
}

export class PartnerPortalTeamNotFoundError extends Error {
  public constructor() {
    super('Portal user not found')
    this.name = 'PartnerPortalTeamNotFoundError'
  }
}

export class PartnerPortalTeamValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalTeamValidationError'
  }
}

@injectable()
export class PartnerPortalTeamService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
  ) {}

  public async createUser(
    principal: PartnerPortalPrincipal,
    input: PartnerPortalUserCreateInput,
  ): Promise<PartnerPortalResetTokenResult> {
    let email: string
    try {
      email = normalizePartnerPortalEmail(input.email)
    }
    catch (error) {
      if (error instanceof PartnerPortalCredentialValidationError) {
        throw new PartnerPortalTeamValidationError(error.message)
      }
      throw error
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS)
    const resetToken = buildPartnerPortalToken()
    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      return await prismaClient.$transaction(async (transaction) => {
        const user = await transaction.partnerPortalUser.create({
          data: {
            email,
            partnerId: principal.partner.id,
            role: input.role,
          },
        })
        await transaction.partnerPortalPasswordResetToken.create({
          data: {
            createdByUserId: principal.userId,
            expiresAt,
            purpose: PartnerPortalPasswordResetPurpose.INVITATION,
            tokenHash: resetToken.tokenHash,
            userId: user.id,
          },
        })
        await this.auditService.record({
          action: 'team.user_created',
          actorUserId: principal.userId,
          metadata: { role: input.role },
          partnerId: principal.partner.id,
          resourceId: user.id,
          resourceType: 'portal_user',
        }, transaction)
        return {
          expiresAt,
          purpose: PartnerPortalPasswordResetPurpose.INVITATION,
          token: resetToken.plaintext,
          user: this.toSummary(user),
        }
      })
    }
    catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new PartnerPortalTeamValidationError('Portal email is already assigned')
      }
      throw error
    }
  }

  public async issuePasswordReset(
    principal: PartnerPortalPrincipal,
    userId: string,
  ): Promise<PartnerPortalResetTokenResult> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS)
    const resetToken = buildPartnerPortalToken()
    const prismaClient = await this.databaseClientProvider.getClient()
    return prismaClient.$transaction(async (transaction) => {
      const user = await transaction.partnerPortalUser.findFirst({
        where: { id: userId, partnerId: principal.partner.id },
      })
      if (!user) {
        throw new PartnerPortalTeamNotFoundError()
      }
      if (user.disabledAt) {
        throw new PartnerPortalTeamValidationError(
          'Enable the portal user before issuing a password reset',
        )
      }
      await transaction.partnerPortalPasswordResetToken.updateMany({
        data: { consumedAt: now },
        where: { consumedAt: null, userId },
      })
      await transaction.partnerPortalPasswordResetToken.create({
        data: {
          createdByUserId: principal.userId,
          expiresAt,
          purpose: PartnerPortalPasswordResetPurpose.PASSWORD_RESET,
          tokenHash: resetToken.tokenHash,
          userId,
        },
      })
      await this.auditService.record({
        action: 'team.password_reset_issued',
        actorUserId: principal.userId,
        partnerId: principal.partner.id,
        resourceId: userId,
        resourceType: 'portal_user',
      }, transaction)
      return {
        expiresAt,
        purpose: PartnerPortalPasswordResetPurpose.PASSWORD_RESET,
        token: resetToken.plaintext,
        user: this.toSummary(user),
      }
    })
  }

  public async listAuditEvents(
    partnerId: string,
    limit = 50,
  ): Promise<PartnerPortalAuditEventDto[]> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const events = await prismaClient.partnerPortalAuditEvent.findMany({
      include: { actor: { select: { email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
      where: { partnerId },
    })
    return events.map(event => ({
      action: event.action,
      actorEmail: event.actor?.email ?? null,
      createdAt: event.createdAt,
      id: event.id,
      resourceId: event.resourceId,
      resourceType: event.resourceType,
    }))
  }

  public async listUsers(partnerId: string): Promise<PartnerPortalUserSummary[]> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const users = await prismaClient.partnerPortalUser.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      where: { partnerId },
    })
    return users.map(user => this.toSummary(user))
  }

  public async resetMfa(
    principal: PartnerPortalPrincipal,
    userId: string,
  ): Promise<PartnerPortalUserSummary> {
    if (userId === principal.userId) {
      throw new PartnerPortalTeamValidationError(
        'Another administrator must reset your MFA factor',
      )
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    return prismaClient.$transaction(async (transaction) => {
      const user = await transaction.partnerPortalUser.findFirst({
        where: { id: userId, partnerId: principal.partner.id },
      })
      if (!user) {
        throw new PartnerPortalTeamNotFoundError()
      }
      await transaction.partnerPortalMfaRecoveryCode.deleteMany({ where: { userId } })
      const updated = await transaction.partnerPortalUser.update({
        data: {
          mfaEnabledAt: null,
          mfaFailedAttempts: 0,
          mfaLastUsedCounter: null,
          mfaLockedUntil: null,
          mfaPendingCreatedAt: null,
          mfaPendingSecretCiphertext: null,
          mfaSecretCiphertext: null,
          sessionVersion: { increment: 1 },
        },
        where: { id: userId },
      })
      await this.auditService.record({
        action: 'team.mfa_reset',
        actorUserId: principal.userId,
        partnerId: principal.partner.id,
        resourceId: userId,
        resourceType: 'portal_user',
      }, transaction)
      return this.toSummary(updated)
    })
  }

  public async updateUser(
    principal: PartnerPortalPrincipal,
    userId: string,
    input: PartnerPortalTeamUpdateInput,
  ): Promise<PartnerPortalUserSummary> {
    if (input.disabled === undefined && input.role === undefined) {
      throw new PartnerPortalTeamValidationError('No account change was requested')
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    return prismaClient.$transaction(async (transaction) => {
      const user = await transaction.partnerPortalUser.findFirst({
        where: { id: userId, partnerId: principal.partner.id },
      })
      if (!user) {
        throw new PartnerPortalTeamNotFoundError()
      }
      const removesAdmin = user.role === PartnerPortalRole.ADMIN && (
        input.disabled === true
        || input.role === PartnerPortalRole.MEMBER
      )
      if (userId === principal.userId && removesAdmin) {
        throw new PartnerPortalTeamValidationError(
          'You cannot disable or remove your own administrator access',
        )
      }
      if (removesAdmin) {
        const activeAdministratorCount = await transaction.partnerPortalUser.count({
          where: {
            disabledAt: null,
            partnerId: principal.partner.id,
            role: PartnerPortalRole.ADMIN,
          },
        })
        if (activeAdministratorCount <= 1) {
          throw new PartnerPortalTeamValidationError(
            'At least one active administrator is required',
          )
        }
      }

      const disabledAt = input.disabled === undefined
        ? undefined
        : input.disabled ? new Date() : null
      const updated = await transaction.partnerPortalUser.update({
        data: {
          disabledAt,
          failedLoginAttempts: input.disabled === false ? 0 : undefined,
          lockedUntil: input.disabled === false ? null : undefined,
          role: input.role,
          sessionVersion: { increment: 1 },
        },
        where: { id: userId },
      })
      await this.auditService.record({
        action: 'team.user_updated',
        actorUserId: principal.userId,
        metadata: {
          ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
          ...(input.role === undefined ? {} : { role: input.role }),
        },
        partnerId: principal.partner.id,
        resourceId: userId,
        resourceType: 'portal_user',
      }, transaction)
      return this.toSummary(updated)
    })
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private toSummary(user: {
    createdAt: Date
    disabledAt: Date | null
    email: string
    id: string
    lastLoginAt: Date | null
    mfaEnabledAt: Date | null
    role: PartnerPortalRole
  }): PartnerPortalUserSummary {
    return {
      createdAt: user.createdAt,
      disabledAt: user.disabledAt,
      email: user.email,
      id: user.id,
      lastLoginAt: user.lastLoginAt,
      mfaEnabled: Boolean(user.mfaEnabledAt),
      role: user.role,
    }
  }
}
