import type { PrismaClient } from '@prisma/client'

import { PartnerPortalEmailDeliveryStatus, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { randomUUID } from 'node:crypto'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from './PartnerPortalAuditService'
import { buildPartnerPortalToken, hashPartnerPortalToken, normalizePartnerPortalEmail, PartnerPortalCredentialValidationError } from './partnerPortalCredentials'
import { partnerPortalVerificationTokenContext } from './PartnerPortalEmailDeliveryLifecycleService'
import { PartnerPortalPasswordService, PartnerPortalPasswordValidationError } from './PartnerPortalPasswordService'
import { PartnerPortalSecretEnvelopeService } from './PartnerPortalSecretEnvelopeService'
import { PartnerPortalSession, PartnerPortalSessionService } from './PartnerPortalSessionService'
import { PartnerPortalSignupChallenge, PartnerPortalSignupProtectionService } from './PartnerPortalSignupProtectionService'
import { PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND } from './PartnerPortalVerificationEmailOutboxHandler'

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

type PreparedVerificationToken = {
  ciphertext: string
  expiresAt: Date
  id: string
  tokenHash: string
}

type RecoveryOutcome
  = | 'ACCOUNT_NOT_ELIGIBLE'
    | 'COALESCED'
    | 'CREDENTIALS_INVALID'
    | 'ENQUEUED'
    | 'IDEMPOTENT_REPLAY'

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

export type PartnerPortalVerificationEmailResendInput = {
  challengeToken: string
  clientIp: string
  email: string
  honeypot: string
  password: string
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
    @inject(PartnerPortalSecretEnvelopeService)
    private readonly secretEnvelopeService: PartnerPortalSecretEnvelopeService,
    @inject(TYPES.IOutboxDispatcher)
    private readonly outboxDispatcher: OutboxDispatcher,
    @inject(PartnerPortalSessionService)
    private readonly sessionService: PartnerPortalSessionService,
  ) {}

  public createChallenge(clientIp: string): Promise<PartnerPortalSignupChallenge> {
    return this.protectionService.createChallenge(clientIp)
  }

  public async resendVerificationEmail(
    input: PartnerPortalVerificationEmailResendInput,
  ): Promise<PartnerPortalSignupAcknowledgement> {
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
    await this.protectionService.assertResendAllowed({
      challengeToken: input.challengeToken,
      clientIp: input.clientIp,
      email,
      honeypot: input.honeypot,
    })
    const prismaClient = await this.databaseClientProvider.getClient()
    const portalUser = await prismaClient.partnerPortalUser.findUnique({
      where: { email },
    })
    if (!portalUser?.passwordVerifier) {
      await this.passwordService.performDummyVerification(input.password)
      this.logRecoveryOutcome('ACCOUNT_NOT_ELIGIBLE')
      return { status: 'VERIFICATION_REQUIRED' }
    }
    const passwordMatches = await this.passwordService.verify(
      input.password,
      portalUser.passwordVerifier,
    )
    if (!passwordMatches) {
      this.logRecoveryOutcome('CREDENTIALS_INVALID')
      return { status: 'VERIFICATION_REQUIRED' }
    }
    if (
      portalUser.disabledAt
      || !portalUser.emailVerificationRequiredAt
      || portalUser.emailVerifiedAt
    ) {
      this.logRecoveryOutcome('ACCOUNT_NOT_ELIGIBLE')
      return { status: 'VERIFICATION_REQUIRED' }
    }

    const now = new Date()
    const token = await this.prepareVerificationToken(now)
    const outcome = await this.executeSerializable(prismaClient, async (transaction) => {
      const currentPortalUser = await transaction.partnerPortalUser.findUnique({
        where: { id: portalUser.id },
      })
      if (
        !currentPortalUser
        || currentPortalUser.passwordVerifier !== portalUser.passwordVerifier
        || currentPortalUser.disabledAt
        || !currentPortalUser.emailVerificationRequiredAt
        || currentPortalUser.emailVerifiedAt
      ) {
        return 'ACCOUNT_NOT_ELIGIBLE' as const
      }
      const latestToken = await transaction.partnerPortalEmailVerificationToken.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          consumedAt: null,
          expiresAt: { gt: now },
          userId: portalUser.id,
        },
      })
      if (this.shouldCoalesce(latestToken, now)) {
        return 'COALESCED' as const
      }
      await transaction.partnerPortalEmailVerificationToken.updateMany({
        data: { expiresAt: now, tokenCiphertext: null },
        where: {
          consumedAt: null,
          expiresAt: { gt: now },
          userId: portalUser.id,
        },
      })
      const createdToken = await transaction.partnerPortalEmailVerificationToken.create({
        data: {
          expiresAt: token.expiresAt,
          id: token.id,
          tokenCiphertext: token.ciphertext,
          tokenHash: token.tokenHash,
          userId: portalUser.id,
        },
      })
      await this.enqueueVerificationEmail(
        transaction,
        createdToken.id,
        portalUser.partnerId,
      )
      await this.auditService.record({
        action: 'signup.verification_email_requested',
        partnerId: portalUser.partnerId,
        resourceId: portalUser.id,
        resourceType: 'partner_portal_user',
      }, transaction)
      return 'ENQUEUED' as const
    })
    this.logRecoveryOutcome(outcome)
    return { status: 'VERIFICATION_REQUIRED' }
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
      this.logRecoveryOutcome('IDEMPOTENT_REPLAY')
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

    const now = new Date()
    const token = await this.prepareVerificationToken(now)
    try {
      await this.executeSerializable(prismaClient, async (transaction) => {
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
            expiresAt: token.expiresAt,
            id: token.id,
            tokenCiphertext: token.ciphertext,
            tokenHash: token.tokenHash,
            userId: portalUser.id,
          },
        })
        await this.enqueueVerificationEmail(
          transaction,
          verificationToken.id,
          partner.id,
        )
        await this.auditService.record({
          action: 'signup.created',
          partnerId: partner.id,
          resourceId: portalUser.id,
          resourceType: 'partner_portal_user',
        }, transaction)
      })
      this.logRecoveryOutcome('ENQUEUED')
    }
    catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error
      }
      this.logRecoveryOutcome('IDEMPOTENT_REPLAY')
    }

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

  private async enqueueVerificationEmail(
    transaction: Prisma.TransactionClient,
    tokenId: string,
    partnerId: string,
  ): Promise<void> {
    await this.outboxDispatcher.enqueueCustom(
      PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND,
      { tokenId },
      'partner-signup-verification',
      {
        client: transaction,
        deliverNow: false,
        metadata: {
          idempotencyKey: `partner-signup-email/${tokenId}`,
          maxAttempts: 5,
          partnerId,
        },
      },
    )
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

  private isSerializationError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  private logRecoveryOutcome(outcome: RecoveryOutcome): void {
    this.logger.info('Partner signup email recovery evaluated', { outcome })
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

  private async prepareVerificationToken(now: Date): Promise<PreparedVerificationToken> {
    const id = randomUUID()
    const token = buildPartnerPortalToken()
    return {
      ciphertext: await this.secretEnvelopeService.encrypt(
        token.plaintext,
        partnerPortalVerificationTokenContext(id),
      ),
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
      id,
      tokenHash: token.tokenHash,
    }
  }

  private shouldCoalesce(
    token: null | {
      createdAt: Date
      deliveryStatus: PartnerPortalEmailDeliveryStatus
    },
    now: Date,
  ): boolean {
    if (!token) {
      return false
    }
    if (token.deliveryStatus === PartnerPortalEmailDeliveryStatus.PENDING) {
      return true
    }
    const terminalFailures = new Set<PartnerPortalEmailDeliveryStatus>([
      PartnerPortalEmailDeliveryStatus.BOUNCED,
      PartnerPortalEmailDeliveryStatus.COMPLAINED,
      PartnerPortalEmailDeliveryStatus.FAILED,
      PartnerPortalEmailDeliveryStatus.SUPPRESSED,
      PartnerPortalEmailDeliveryStatus.UNAVAILABLE,
    ])
    return !terminalFailures.has(token.deliveryStatus)
      && token.createdAt >= new Date(now.getTime() - RESEND_COOLDOWN_MS)
  }
}
