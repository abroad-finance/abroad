import type { PartnerPortalUser, Prisma } from '@prisma/client'

import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { hashPartnerPortalToken, normalizePartnerPortalEmail, PartnerPortalCredentialValidationError } from './partnerPortalCredentials'
import { PartnerPortalMfaService, PartnerPortalMfaValidationError } from './PartnerPortalMfaService'
import { PartnerPortalPasswordService, PartnerPortalPasswordValidationError } from './PartnerPortalPasswordService'
import { PartnerPortalSecretEnvelopeService } from './PartnerPortalSecretEnvelopeService'
import { PartnerPortalPrincipal, PartnerPortalSession, PartnerPortalSessionService, PartnerPortalSessionUser } from './PartnerPortalSessionService'

const MFA_ENROLLMENT_TTL_MS = 10 * 60 * 1_000
const MFA_LOCK_DURATION_MS = 15 * 60 * 1_000
const MAX_FAILED_MFA_ATTEMPTS = 5

const portalUserWithPartner = {
  partner: true,
} satisfies Prisma.PartnerPortalUserInclude

export type PartnerPortalMfaConfirmationResult = {
  recoveryCodes: string[]
  session: PartnerPortalSession
}

export type PartnerPortalMfaEnrollmentResult = {
  expiresAt: Date
  manualEntryKey: string
  otpauthUri: string
}

export class PartnerPortalIdentityAuthenticationError extends Error {
  public constructor(message = 'Authentication could not be verified') {
    super(message)
    this.name = 'PartnerPortalIdentityAuthenticationError'
  }
}

export class PartnerPortalIdentityValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPortalIdentityValidationError'
  }
}

@injectable()
export class PartnerPortalIdentityService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
    @inject(PartnerPortalMfaService)
    private readonly mfaService: PartnerPortalMfaService,
    @inject(PartnerPortalPasswordService)
    private readonly passwordService: PartnerPortalPasswordService,
    @inject(PartnerPortalSecretEnvelopeService)
    private readonly secretEnvelopeService: PartnerPortalSecretEnvelopeService,
    @inject(PartnerPortalSessionService)
    private readonly sessionService: PartnerPortalSessionService,
  ) {}

  public async beginMfaEnrollment(
    principal: PartnerPortalPrincipal,
    currentPassword: string,
  ): Promise<PartnerPortalMfaEnrollmentResult> {
    if (principal.mfaEnabled && !principal.mfaVerified) {
      throw new PartnerPortalIdentityAuthenticationError('Verify the existing MFA factor first')
    }

    const portalUser = await this.findPortalUser(principal)
    await this.verifyCurrentPassword(portalUser, currentPassword)
    const enrollment = this.mfaService.buildEnrollment(
      portalUser.email,
      portalUser.partner.name,
    )
    const encryptedSecret = await this.secretEnvelopeService.encrypt(
      enrollment.secret,
      this.mfaContext(portalUser.id, 'pending'),
    )
    const now = new Date()
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      await transaction.partnerPortalUser.update({
        data: {
          mfaPendingCreatedAt: now,
          mfaPendingSecretCiphertext: encryptedSecret,
        },
        where: { id: portalUser.id },
      })
      await this.auditService.record({
        action: 'mfa.enrollment_started',
        actorUserId: portalUser.id,
        partnerId: portalUser.partnerId,
        resourceId: portalUser.id,
        resourceType: 'portal_user',
      }, transaction)
    })

    return {
      expiresAt: new Date(now.getTime() + MFA_ENROLLMENT_TTL_MS),
      manualEntryKey: enrollment.manualEntryKey,
      otpauthUri: enrollment.otpauthUri,
    }
  }

  public async changePassword(
    principal: PartnerPortalPrincipal,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (principal.mfaEnabled && !principal.mfaVerified) {
      throw new PartnerPortalIdentityAuthenticationError('MFA verification is required')
    }
    const portalUser = await this.findPortalUser(principal)
    await this.verifyCurrentPassword(portalUser, currentPassword)
    const passwordVerifier = await this.buildPasswordVerifier(newPassword)
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      await transaction.partnerPortalUser.update({
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordVerifier,
          sessionVersion: { increment: 1 },
        },
        where: { id: portalUser.id },
      })
      await this.auditService.record({
        action: 'password.changed',
        actorUserId: portalUser.id,
        partnerId: portalUser.partnerId,
        resourceId: portalUser.id,
        resourceType: 'portal_user',
      }, transaction)
    })
  }

  public async completeMfaChallenge(
    challengeToken: string,
    code: string,
  ): Promise<PartnerPortalSession> {
    let portalUser: PartnerPortalSessionUser
    try {
      portalUser = await this.sessionService.verifyMfaChallenge(challengeToken)
    }
    catch {
      throw new PartnerPortalIdentityAuthenticationError()
    }
    const now = new Date()
    if (portalUser.mfaLockedUntil && portalUser.mfaLockedUntil > now) {
      throw new PartnerPortalIdentityAuthenticationError()
    }

    try {
      await this.consumeSecondFactor(portalUser, code, now)
    }
    catch (error) {
      if (error instanceof PartnerPortalIdentityAuthenticationError) {
        await this.recordFailedMfaAttempt(portalUser, now)
        throw error
      }
      throw error
    }

    const authenticatedUser = await this.findPortalUserById(portalUser.id)
    return this.sessionService.createSession(authenticatedUser, true)
  }

  public async confirmMfaEnrollment(
    principal: PartnerPortalPrincipal,
    code: string,
  ): Promise<PartnerPortalMfaConfirmationResult> {
    const portalUser = await this.findPortalUser(principal)
    const now = new Date()
    if (
      !portalUser.mfaPendingCreatedAt
      || !portalUser.mfaPendingSecretCiphertext
      || now.getTime() - portalUser.mfaPendingCreatedAt.getTime() > MFA_ENROLLMENT_TTL_MS
    ) {
      throw new PartnerPortalIdentityValidationError('MFA enrollment has expired')
    }

    const pendingSecret = await this.secretEnvelopeService.decrypt(
      portalUser.mfaPendingSecretCiphertext,
      this.mfaContext(portalUser.id, 'pending'),
    )
    let counter: bigint
    try {
      counter = this.mfaService.verifyTotp(pendingSecret, code, null, now)
    }
    catch (error) {
      if (error instanceof PartnerPortalMfaValidationError) {
        throw new PartnerPortalIdentityAuthenticationError('Authentication code is invalid')
      }
      throw error
    }

    const encryptedSecret = await this.secretEnvelopeService.encrypt(
      pendingSecret,
      this.mfaContext(portalUser.id, 'active'),
    )
    const recoveryCodes = this.mfaService.generateRecoveryCodes()
    const prismaClient = await this.databaseClientProvider.getClient()
    const updatedUser = await prismaClient.$transaction(async (transaction) => {
      await transaction.partnerPortalMfaRecoveryCode.deleteMany({
        where: { userId: portalUser.id },
      })
      await transaction.partnerPortalMfaRecoveryCode.createMany({
        data: recoveryCodes.map(recoveryCode => ({
          codeHash: recoveryCode.codeHash,
          userId: portalUser.id,
        })),
      })
      const updated = await transaction.partnerPortalUser.update({
        data: {
          mfaEnabledAt: now,
          mfaFailedAttempts: 0,
          mfaLastUsedCounter: counter,
          mfaLockedUntil: null,
          mfaPendingCreatedAt: null,
          mfaPendingSecretCiphertext: null,
          mfaSecretCiphertext: encryptedSecret,
          sessionVersion: { increment: 1 },
        },
        include: portalUserWithPartner,
        where: { id: portalUser.id },
      })
      await this.auditService.record({
        action: 'mfa.enabled',
        actorUserId: portalUser.id,
        partnerId: portalUser.partnerId,
        resourceId: portalUser.id,
        resourceType: 'portal_user',
      }, transaction)
      return updated
    })

    return {
      recoveryCodes: recoveryCodes.map(recoveryCode => recoveryCode.plaintext),
      session: await this.sessionService.createSession(updatedUser, true),
    }
  }

  public async regenerateRecoveryCodes(
    principal: PartnerPortalPrincipal,
    currentPassword: string,
  ): Promise<string[]> {
    if (!principal.mfaEnabled || !principal.mfaVerified) {
      throw new PartnerPortalIdentityAuthenticationError('MFA verification is required')
    }
    const portalUser = await this.findPortalUser(principal)
    await this.verifyCurrentPassword(portalUser, currentPassword)
    const recoveryCodes = this.mfaService.generateRecoveryCodes()
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      await transaction.partnerPortalMfaRecoveryCode.deleteMany({
        where: { userId: portalUser.id },
      })
      await transaction.partnerPortalMfaRecoveryCode.createMany({
        data: recoveryCodes.map(recoveryCode => ({
          codeHash: recoveryCode.codeHash,
          userId: portalUser.id,
        })),
      })
      await this.auditService.record({
        action: 'mfa.recovery_codes_regenerated',
        actorUserId: portalUser.id,
        partnerId: portalUser.partnerId,
        resourceId: portalUser.id,
        resourceType: 'portal_user',
      }, transaction)
    })
    return recoveryCodes.map(recoveryCode => recoveryCode.plaintext)
  }

  public async resetPasswordWithRecoveryCode(
    email: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<void> {
    const passwordVerifier = await this.buildPasswordVerifier(newPassword)
    let normalizedEmail: string
    let codeHash: string
    try {
      normalizedEmail = normalizePartnerPortalEmail(email)
      codeHash = this.mfaService.hashRecoveryCode(recoveryCode)
    }
    catch (error) {
      if (
        error instanceof PartnerPortalCredentialValidationError
        || error instanceof PartnerPortalMfaValidationError
      ) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
      throw error
    }

    const prismaClient = await this.databaseClientProvider.getClient()
    const portalUser = await prismaClient.partnerPortalUser.findUnique({
      where: { email: normalizedEmail },
    })
    if (!portalUser || portalUser.disabledAt) {
      throw new PartnerPortalIdentityAuthenticationError()
    }

    await prismaClient.$transaction(async (transaction) => {
      const consumed = await transaction.partnerPortalMfaRecoveryCode.updateMany({
        data: { consumedAt: new Date() },
        where: {
          codeHash,
          consumedAt: null,
          userId: portalUser.id,
        },
      })
      if (consumed.count !== 1) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
      await transaction.partnerPortalUser.update({
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordVerifier,
          sessionVersion: { increment: 1 },
        },
        where: { id: portalUser.id },
      })
      await this.auditService.record({
        action: 'password.recovered_with_code',
        actorUserId: portalUser.id,
        partnerId: portalUser.partnerId,
        resourceId: portalUser.id,
        resourceType: 'portal_user',
      }, transaction)
    })
  }

  public async resetPasswordWithToken(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const passwordVerifier = await this.buildPasswordVerifier(newPassword)
    let tokenHash: string
    try {
      tokenHash = hashPartnerPortalToken(token)
    }
    catch (error) {
      if (error instanceof PartnerPortalCredentialValidationError) {
        throw new PartnerPortalIdentityAuthenticationError('Reset link is invalid or expired')
      }
      throw error
    }

    const now = new Date()
    const prismaClient = await this.databaseClientProvider.getClient()
    const resetToken = await prismaClient.partnerPortalPasswordResetToken.findUnique({
      include: { user: true },
      where: { tokenHash },
    })
    if (
      !resetToken
      || resetToken.consumedAt
      || resetToken.expiresAt <= now
      || resetToken.user.disabledAt
    ) {
      throw new PartnerPortalIdentityAuthenticationError('Reset link is invalid or expired')
    }

    await prismaClient.$transaction(async (transaction) => {
      const consumed = await transaction.partnerPortalPasswordResetToken.updateMany({
        data: { consumedAt: now },
        where: {
          consumedAt: null,
          expiresAt: { gt: now },
          id: resetToken.id,
        },
      })
      if (consumed.count !== 1) {
        throw new PartnerPortalIdentityAuthenticationError('Reset link is invalid or expired')
      }
      await transaction.partnerPortalUser.update({
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          passwordVerifier,
          sessionVersion: { increment: 1 },
        },
        where: { id: resetToken.userId },
      })
      await this.auditService.record({
        action: resetToken.purpose === 'INVITATION'
          ? 'password.initialized'
          : 'password.reset',
        actorUserId: resetToken.userId,
        partnerId: resetToken.user.partnerId,
        resourceId: resetToken.userId,
        resourceType: 'portal_user',
      }, transaction)
    })
  }

  private async buildPasswordVerifier(password: string): Promise<string> {
    try {
      return await this.passwordService.buildVerifier(password)
    }
    catch (error) {
      if (error instanceof PartnerPortalPasswordValidationError) {
        throw new PartnerPortalIdentityValidationError(error.message)
      }
      throw error
    }
  }

  private async consumeSecondFactor(
    portalUser: PartnerPortalSessionUser,
    code: string,
    now: Date,
  ): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    if (/^\d{6}$/u.test(code.trim())) {
      if (!portalUser.mfaSecretCiphertext) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
      const secret = await this.secretEnvelopeService.decrypt(
        portalUser.mfaSecretCiphertext,
        this.mfaContext(portalUser.id, 'active'),
      )
      let counter: bigint
      try {
        counter = this.mfaService.verifyTotp(
          secret,
          code,
          portalUser.mfaLastUsedCounter,
          now,
        )
      }
      catch (error) {
        if (error instanceof PartnerPortalMfaValidationError) {
          throw new PartnerPortalIdentityAuthenticationError()
        }
        throw error
      }
      const updated = await prismaClient.partnerPortalUser.updateMany({
        data: {
          mfaFailedAttempts: 0,
          mfaLastUsedCounter: counter,
          mfaLockedUntil: null,
        },
        where: {
          AND: [
            {
              OR: [
                { mfaLastUsedCounter: null },
                { mfaLastUsedCounter: { lt: counter } },
              ],
            },
            {
              OR: [
                { mfaLockedUntil: null },
                { mfaLockedUntil: { lte: now } },
              ],
            },
          ],
          id: portalUser.id,
        },
      })
      if (updated.count !== 1) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
      return
    }

    let codeHash: string
    try {
      codeHash = this.mfaService.hashRecoveryCode(code)
    }
    catch (error) {
      if (error instanceof PartnerPortalMfaValidationError) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
      throw error
    }
    await prismaClient.$transaction(async (transaction) => {
      const unlocked = await transaction.partnerPortalUser.updateMany({
        data: { mfaFailedAttempts: 0, mfaLockedUntil: null },
        where: {
          id: portalUser.id,
          OR: [
            { mfaLockedUntil: null },
            { mfaLockedUntil: { lte: now } },
          ],
        },
      })
      if (unlocked.count !== 1) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
      const consumed = await transaction.partnerPortalMfaRecoveryCode.updateMany({
        data: { consumedAt: now },
        where: {
          codeHash,
          consumedAt: null,
          userId: portalUser.id,
        },
      })
      if (consumed.count !== 1) {
        throw new PartnerPortalIdentityAuthenticationError()
      }
    })
  }

  private async findPortalUser(
    principal: PartnerPortalPrincipal,
  ): Promise<PartnerPortalSessionUser> {
    const portalUser = await this.findPortalUserById(principal.userId)
    if (portalUser.partnerId !== principal.partner.id) {
      throw new PartnerPortalIdentityAuthenticationError()
    }
    return portalUser
  }

  private async findPortalUserById(userId: string): Promise<PartnerPortalSessionUser> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const portalUser = await prismaClient.partnerPortalUser.findUnique({
      include: portalUserWithPartner,
      where: { id: userId },
    })
    if (!portalUser || portalUser.disabledAt || portalUser.passwordVerifier === null) {
      throw new PartnerPortalIdentityAuthenticationError()
    }
    return portalUser
  }

  private mfaContext(userId: string, state: 'active' | 'pending'): string {
    return `partner-portal:mfa:${userId}:${state}`
  }

  private async recordFailedMfaAttempt(
    portalUser: PartnerPortalUser,
    now: Date,
  ): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      if (portalUser.mfaLockedUntil && portalUser.mfaLockedUntil <= now) {
        await transaction.partnerPortalUser.updateMany({
          data: { mfaFailedAttempts: 0, mfaLockedUntil: null },
          where: { id: portalUser.id, mfaLockedUntil: { lte: now } },
        })
      }
      const failedState = await transaction.partnerPortalUser.update({
        data: { mfaFailedAttempts: { increment: 1 } },
        select: { mfaFailedAttempts: true },
        where: { id: portalUser.id },
      })
      if (failedState.mfaFailedAttempts >= MAX_FAILED_MFA_ATTEMPTS) {
        await transaction.partnerPortalUser.update({
          data: { mfaLockedUntil: new Date(now.getTime() + MFA_LOCK_DURATION_MS) },
          where: { id: portalUser.id },
        })
      }
    })
  }

  private async verifyCurrentPassword(
    portalUser: PartnerPortalSessionUser,
    password: string,
  ): Promise<void> {
    if (
      !portalUser.passwordVerifier
      || !await this.passwordService.verify(password, portalUser.passwordVerifier)
    ) {
      throw new PartnerPortalIdentityAuthenticationError('Current password is incorrect')
    }
  }
}
