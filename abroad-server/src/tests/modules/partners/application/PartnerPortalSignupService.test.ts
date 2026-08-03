import 'reflect-metadata'

import type { Partner, PartnerPortalEmailVerificationToken, PartnerPortalUser, PrismaClient } from '@prisma/client'

import { PartnerPortalEmailDeliveryStatus, PartnerPortalRole, Prisma } from '@prisma/client'

import { ILogger } from '../../../../core/logging/types'
import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPasswordService } from '../../../../modules/partners/application/PartnerPortalPasswordService'
import { PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PartnerPortalSessionService } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPortalSignupProtectionService } from '../../../../modules/partners/application/PartnerPortalSignupProtectionService'
import { PartnerPortalEmailVerificationError, PartnerPortalSignupService } from '../../../../modules/partners/application/PartnerPortalSignupService'
import { PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND } from '../../../../modules/partners/application/PartnerPortalVerificationEmailOutboxHandler'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const now = new Date('2026-08-02T15:00:00.000Z')
const password = 'correct horse battery staple'

const buildPartner = (overrides: Partial<Partner> = {}): Partner => ({
  apiKey: null,
  clientDomain: null,
  clientDomainHash: null,
  country: 'BR',
  createdAt: now,
  email: 'admin@atlas.example',
  firstName: 'Ana',
  id: '11111111-1111-4111-8111-111111111111',
  isKybApproved: false,
  lastName: 'Silva',
  name: 'Atlas Payments',
  needsKyc: true,
  phone: null,
  previousApiKey: null,
  previousApiKeyExpiresAt: null,
  publicSignupIdempotencyHash: 'hash:idempotency:signup-request-001',
  publicSignupOrganizationHash: 'hash:organization:atlaspayments\u001fbr',
  webhookUrl: null,
  ...overrides,
})

const buildPortalUser = (overrides: Partial<PartnerPortalUser> = {}): PartnerPortalUser => ({
  createdAt: now,
  disabledAt: null,
  email: 'admin@atlas.example',
  emailVerificationRequiredAt: now,
  emailVerifiedAt: null,
  failedLoginAttempts: 0,
  id: '22222222-2222-4222-8222-222222222222',
  lastLoginAt: null,
  lockedUntil: null,
  mfaEnabledAt: null,
  mfaFailedAttempts: 0,
  mfaLastUsedCounter: null,
  mfaLockedUntil: null,
  mfaPendingCreatedAt: null,
  mfaPendingSecretCiphertext: null,
  mfaSecretCiphertext: null,
  partnerId: buildPartner().id,
  passwordVerifier: 'stored-scrypt-verifier',
  role: PartnerPortalRole.ADMIN,
  sessionVersion: 1,
  updatedAt: now,
  ...overrides,
})

const buildVerificationToken = (
  overrides: Partial<PartnerPortalEmailVerificationToken> = {},
): PartnerPortalEmailVerificationToken => ({
  consumedAt: null,
  createdAt: now,
  deliveredAt: null,
  deliveryAttemptCount: 0,
  deliveryFailureCode: null,
  deliveryStatus: PartnerPortalEmailDeliveryStatus.PENDING,
  deliveryStatusUpdatedAt: now,
  expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
  id: '33333333-3333-4333-8333-333333333333',
  lastDeliveryAttemptAt: null,
  providerMessageId: null,
  sentAt: null,
  tokenCiphertext: 'v1.iv.tag.ciphertext',
  tokenHash: 'stored-token-hash',
  userId: buildPortalUser().id,
  ...overrides,
})

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError => (
  new Prisma.PrismaClientKnownRequestError('database conflict', {
    clientVersion: 'test',
    code,
  })
)

const signupInput = {
  challengeToken: 'signed-challenge-token-that-is-long-enough',
  clientIp: '203.0.113.10',
  company: '  Atlas   Payments  ',
  country: ' br ',
  email: ' Admin@Atlas.Example ',
  firstName: ' Ana ',
  honeypot: '',
  idempotencyKey: 'signup-request-001',
  lastName: ' Silva ',
  password,
}

const buildHarness = () => {
  const partnerCreate = jest.fn(async () => buildPartner())
  const partnerFindUnique = jest.fn<Promise<null | Partner>, [unknown]>(async () => null)
  const portalUserCreate = jest.fn(async () => buildPortalUser())
  const portalUserFindUnique = jest.fn<Promise<null | PartnerPortalUser>, [unknown]>(
    async () => buildPortalUser(),
  )
  const transactionPortalUserFindUnique = jest.fn<Promise<null | PartnerPortalUser>, [unknown]>(
    async () => buildPortalUser(),
  )
  const portalUserUpdate = jest.fn(async () => ({
    ...buildPortalUser({ emailVerifiedAt: now }),
    partner: buildPartner(),
  }))
  const tokenCreate = jest.fn(async (input: { data: Record<string, unknown> }) => (
    buildVerificationToken({
      expiresAt: input.data.expiresAt as Date,
      id: String(input.data.id),
      tokenCiphertext: String(input.data.tokenCiphertext),
      tokenHash: String(input.data.tokenHash),
      userId: String(input.data.userId),
    })
  ))
  const transactionTokenFindFirst = jest.fn<
    Promise<null | PartnerPortalEmailVerificationToken>,
    [unknown]
  >(async () => null)
  const tokenFindUnique = jest.fn(async () => ({
    ...buildVerificationToken(),
    user: { ...buildPortalUser(), partner: buildPartner() },
  }))
  const transactionTokenUpdateMany = jest.fn(async () => ({ count: 1 }))
  const transactionClient = {
    partner: { create: partnerCreate },
    partnerPortalEmailVerificationToken: {
      create: tokenCreate,
      findFirst: transactionTokenFindFirst,
      findUnique: tokenFindUnique,
      updateMany: transactionTokenUpdateMany,
    },
    partnerPortalUser: {
      create: portalUserCreate,
      findUnique: transactionPortalUserFindUnique,
      update: portalUserUpdate,
    },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown?]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const databaseClient = {
    $transaction: databaseTransaction,
    partner: { findUnique: partnerFindUnique },
    partnerPortalEmailVerificationToken: {},
    partnerPortalUser: { findUnique: portalUserFindUnique },
  }
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => databaseClient as unknown as PrismaClient),
  }
  const logger: jest.Mocked<ILogger> = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const auditService = {
    record: jest.fn(async () => undefined),
  }
  const passwordService = {
    buildVerifier: jest.fn(async () => 'stored-scrypt-verifier'),
    performDummyVerification: jest.fn(async () => undefined),
    verify: jest.fn(async () => true),
  }
  const protectionService = {
    assertResendAllowed: jest.fn(async () => undefined),
    assertSignupAllowed: jest.fn(async () => undefined),
    consumeEmailVerificationAttempt: jest.fn(async () => undefined),
    createChallenge: jest.fn(async () => ({
      challengeToken: 'challenge',
      expiresAt: new Date(now.getTime() + 900_000),
      readyAt: new Date(now.getTime() + 1_500),
    })),
    hashIdentifier: jest.fn(async (context: string, identifier: string) => (
      `hash:${context}:${identifier}`
    )),
  }
  const secretEnvelopeService = {
    encrypt: jest.fn(async (_plaintext: string, context: string) => `encrypted:${context}`),
  }
  const enqueueCustom = jest.fn(async () => buildOutboxRecord())
  const outboxDispatcher = { enqueueCustom }
  const sessionService = {
    createSession: jest.fn(async () => ({
      accessToken: 'portal-session-token',
      email: buildPortalUser().email,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      mfaEnabled: false,
      mfaVerified: false,
      partnerName: buildPartner().name,
      role: PartnerPortalRole.ADMIN,
      userId: buildPortalUser().id,
    })),
  }

  return {
    auditService,
    databaseTransaction,
    enqueueCustom,
    logger,
    partnerCreate,
    partnerFindUnique,
    passwordService,
    portalUserCreate,
    portalUserFindUnique,
    portalUserUpdate,
    protectionService,
    secretEnvelopeService,
    service: new PartnerPortalSignupService(
      databaseClientProvider,
      logger,
      auditService as unknown as PartnerPortalAuditService,
      passwordService as unknown as PartnerPortalPasswordService,
      protectionService as unknown as PartnerPortalSignupProtectionService,
      secretEnvelopeService as unknown as PartnerPortalSecretEnvelopeService,
      outboxDispatcher as unknown as OutboxDispatcher,
      sessionService as unknown as PartnerPortalSessionService,
    ),
    sessionService,
    tokenCreate,
    tokenFindUnique,
    transactionPortalUserFindUnique,
    transactionTokenFindFirst,
    transactionTokenUpdateMany,
  }
}

const buildOutboxRecord = () => ({
  attempts: 0,
  availableAt: now,
  createdAt: now,
  id: '44444444-4444-4444-8444-444444444444',
  idempotencyKey: null,
  initiatedByPortalUserId: null,
  lastAttemptDurationMs: null,
  lastError: null,
  lastHttpStatus: null,
  maxAttempts: 5,
  partnerId: null,
  payload: {},
  sourceOutboxEventId: null,
  status: 'PENDING' as const,
  transactionId: null,
  type: PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND,
  updatedAt: now,
  webhookCredentialMode: null,
  webhookEvent: null,
  webhookPurpose: null,
})

describe('PartnerPortalSignupService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('atomically creates the pending account, encrypted token, and PII-free outbox job', async () => {
    const harness = buildHarness()

    await expect(harness.service.signup(signupInput)).resolves.toEqual({
      status: 'VERIFICATION_REQUIRED',
    })

    expect(harness.protectionService.assertSignupAllowed).toHaveBeenCalledWith({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: 'admin@atlas.example',
      honeypot: '',
      organization: 'atlaspayments\u001fbr',
    })
    expect(harness.partnerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        country: 'BR',
        email: 'admin@atlas.example',
        firstName: 'Ana',
        lastName: 'Silva',
        name: 'Atlas Payments',
      }),
    })
    const tokenData = harness.tokenCreate.mock.calls[0]?.[0].data
    const plaintextToken = harness.secretEnvelopeService.encrypt.mock.calls[0]?.[0]
    expect(tokenData?.tokenHash).not.toBe(plaintextToken)
    expect(String(tokenData?.tokenCiphertext)).not.toContain(String(plaintextToken))
    expect(harness.enqueueCustom).toHaveBeenCalledWith(
      PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND,
      { tokenId: tokenData?.id },
      'partner-signup-verification',
      expect.objectContaining({
        client: expect.anything(),
        deliverNow: false,
        metadata: expect.objectContaining({
          idempotencyKey: `partner-signup-email/${String(tokenData?.id)}`,
          maxAttempts: 5,
        }),
      }),
    )
    expect(JSON.stringify(harness.enqueueCustom.mock.calls)).not.toContain('admin@atlas.example')
    expect(JSON.stringify(harness.enqueueCustom.mock.calls)).not.toContain(password)
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'signup.created' }),
      expect.anything(),
    )
  })

  it('returns the same acknowledgement for an idempotent replay without creating new work', async () => {
    const harness = buildHarness()
    harness.partnerFindUnique.mockResolvedValueOnce(buildPartner())

    await expect(harness.service.signup(signupInput)).resolves.toEqual({
      status: 'VERIFICATION_REQUIRED',
    })

    expect(harness.databaseTransaction).not.toHaveBeenCalled()
    expect(harness.enqueueCustom).not.toHaveBeenCalled()
    expect(harness.logger.info).toHaveBeenCalledWith(
      'Partner signup email recovery evaluated',
      { outcome: 'IDEMPOTENT_REPLAY' },
    )
  })

  it('keeps uniqueness races enumeration-safe without fabricating a delivery', async () => {
    const harness = buildHarness()
    harness.databaseTransaction.mockRejectedValueOnce(prismaError('P2002'))

    await expect(harness.service.signup(signupInput)).resolves.toEqual({
      status: 'VERIFICATION_REQUIRED',
    })

    expect(harness.enqueueCustom).not.toHaveBeenCalled()
    expect(JSON.stringify(harness.logger.info.mock.calls)).not.toContain('admin@atlas.example')
  })

  it('reauthenticates a pending administrator and durably queues a fresh token', async () => {
    const harness = buildHarness()

    await expect(harness.service.resendVerificationEmail({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: signupInput.email,
      honeypot: '',
      password,
    })).resolves.toEqual({ status: 'VERIFICATION_REQUIRED' })

    expect(harness.protectionService.assertResendAllowed).toHaveBeenCalledWith({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: 'admin@atlas.example',
      honeypot: '',
    })
    expect(harness.passwordService.verify).toHaveBeenCalledWith(
      password,
      'stored-scrypt-verifier',
    )
    expect(harness.transactionTokenUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tokenCiphertext: null }),
    }))
    expect(harness.enqueueCustom).toHaveBeenCalledTimes(1)
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'signup.verification_email_requested' }),
      expect.anything(),
    )
  })

  it('returns the generic acknowledgement for unknown and invalid credentials', async () => {
    const unknownHarness = buildHarness()
    unknownHarness.portalUserFindUnique.mockResolvedValueOnce(null)

    await expect(unknownHarness.service.resendVerificationEmail({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: signupInput.email,
      honeypot: '',
      password,
    })).resolves.toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(unknownHarness.passwordService.performDummyVerification).toHaveBeenCalledWith(password)
    expect(unknownHarness.enqueueCustom).not.toHaveBeenCalled()

    const invalidHarness = buildHarness()
    invalidHarness.passwordService.verify.mockResolvedValueOnce(false)
    await expect(invalidHarness.service.resendVerificationEmail({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: signupInput.email,
      honeypot: '',
      password,
    })).resolves.toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(invalidHarness.enqueueCustom).not.toHaveBeenCalled()
  })

  it('coalesces an active pending delivery and retries serialization conflicts', async () => {
    const coalescedHarness = buildHarness()
    coalescedHarness.transactionTokenFindFirst.mockResolvedValueOnce(buildVerificationToken())
    await coalescedHarness.service.resendVerificationEmail({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: signupInput.email,
      honeypot: '',
      password,
    })
    expect(coalescedHarness.enqueueCustom).not.toHaveBeenCalled()
    expect(coalescedHarness.logger.info).toHaveBeenCalledWith(
      'Partner signup email recovery evaluated',
      { outcome: 'COALESCED' },
    )

    const conflictHarness = buildHarness()
    conflictHarness.databaseTransaction.mockRejectedValueOnce(prismaError('P2034'))
    await conflictHarness.service.resendVerificationEmail({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: signupInput.email,
      honeypot: '',
      password,
    })
    expect(conflictHarness.databaseTransaction).toHaveBeenCalledTimes(2)
    expect(conflictHarness.enqueueCustom).toHaveBeenCalledTimes(1)
  })

  it('consumes one valid email token, records the audit, and creates the normal session', async () => {
    const harness = buildHarness()
    const result = await harness.service.verifyEmail(signupInput.clientIp, 'v'.repeat(43))

    expect(result.accessToken).toBe('portal-session-token')
    expect(harness.protectionService.consumeEmailVerificationAttempt).toHaveBeenCalledWith(
      signupInput.clientIp,
    )
    expect(harness.transactionTokenUpdateMany).toHaveBeenCalledWith({
      data: { consumedAt: expect.any(Date) },
      where: {
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
        id: buildVerificationToken().id,
      },
    })
    expect(harness.portalUserUpdate).toHaveBeenCalledWith({
      data: { emailVerifiedAt: expect.any(Date) },
      include: { partner: true },
      where: { id: buildPortalUser().id },
    })
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'signup.email_verified' }),
      expect.anything(),
    )
  })

  it('rejects expired and concurrently consumed verification links without a session', async () => {
    const expiredHarness = buildHarness()
    expiredHarness.tokenFindUnique.mockResolvedValueOnce({
      ...buildVerificationToken({ expiresAt: new Date('2026-08-01T00:00:00.000Z') }),
      user: { ...buildPortalUser(), partner: buildPartner() },
    })
    await expect(expiredHarness.service.verifyEmail(
      signupInput.clientIp,
      'e'.repeat(43),
    )).rejects.toThrow(new PartnerPortalEmailVerificationError())

    const consumedHarness = buildHarness()
    consumedHarness.transactionTokenUpdateMany.mockResolvedValueOnce({ count: 0 })
    await expect(consumedHarness.service.verifyEmail(
      signupInput.clientIp,
      'c'.repeat(43),
    )).rejects.toThrow(new PartnerPortalEmailVerificationError())
    expect(consumedHarness.sessionService.createSession).not.toHaveBeenCalled()
  })
})
