import 'reflect-metadata'

import type { Partner, PartnerPortalEmailVerificationToken, PartnerPortalUser, PrismaClient } from '@prisma/client'

import { PartnerPortalRole, Prisma } from '@prisma/client'

import { ILogger } from '../../../../core/logging/types'
import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPasswordService } from '../../../../modules/partners/application/PartnerPortalPasswordService'
import { PartnerPortalSessionService } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPortalSignupProtectionService } from '../../../../modules/partners/application/PartnerPortalSignupProtectionService'
import { PartnerPortalEmailVerificationError, PartnerPortalSignupService } from '../../../../modules/partners/application/PartnerPortalSignupService'
import { PartnerPortalEmailDeliveryError, ResendPartnerPortalEmailSender } from '../../../../modules/partners/application/ResendPartnerPortalEmailSender'
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
  expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
  id: '33333333-3333-4333-8333-333333333333',
  providerMessageId: null,
  sentAt: null,
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
  const partnerCreate = jest.fn<
    Promise<Partner>,
    [{ data: Record<string, unknown> }]
  >(async () => buildPartner())
  const partnerFindUnique = jest.fn<Promise<null | Partner>, [unknown]>(async () => null)
  const partnerFindFirst = jest.fn<Promise<null | Partner>, [unknown]>(async () => null)
  const portalUserCreate = jest.fn<
    Promise<PartnerPortalUser>,
    [{ data: Record<string, unknown> }]
  >(async () => buildPortalUser())
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
      tokenHash: String(input.data.tokenHash),
      userId: String(input.data.userId),
    })
  ))
  const tokenFindFirst = jest.fn<
    Promise<null | PartnerPortalEmailVerificationToken>,
    [unknown]
  >(async () => null)
  const transactionTokenFindFirst = jest.fn<
    Promise<null | PartnerPortalEmailVerificationToken>,
    [unknown]
  >(async () => null)
  const tokenFindUnique = jest.fn(async () => ({
    ...buildVerificationToken(),
    user: {
      ...buildPortalUser(),
      partner: buildPartner(),
    },
  }))
  const tokenUpdateMany = jest.fn(async () => ({ count: 1 }))
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
    partner: {
      findFirst: partnerFindFirst,
      findUnique: partnerFindUnique,
    },
    partnerPortalEmailVerificationToken: {
      findFirst: tokenFindFirst,
      updateMany: tokenUpdateMany,
    },
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
    record: jest.fn<
      ReturnType<PartnerPortalAuditService['record']>,
      Parameters<PartnerPortalAuditService['record']>
    >(async () => undefined),
  }
  const passwordService = {
    buildVerifier: jest.fn(async () => 'stored-scrypt-verifier'),
    performDummyVerification: jest.fn(async () => undefined),
    verify: jest.fn(async () => true),
  }
  const protectionService = {
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
  const emailSender = {
    sendVerificationEmail: jest.fn<
      ReturnType<ResendPartnerPortalEmailSender['sendVerificationEmail']>,
      Parameters<ResendPartnerPortalEmailSender['sendVerificationEmail']>
    >(async () => ({ providerMessageId: 'resend-message-1' })),
  }
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
    emailSender,
    logger,
    partnerCreate,
    partnerFindFirst,
    partnerFindUnique,
    passwordService,
    portalUserCreate,
    portalUserFindUnique,
    portalUserUpdate,
    protectionService,
    service: new PartnerPortalSignupService(
      databaseClientProvider,
      logger,
      auditService as unknown as PartnerPortalAuditService,
      passwordService as unknown as PartnerPortalPasswordService,
      protectionService as unknown as PartnerPortalSignupProtectionService,
      emailSender as unknown as ResendPartnerPortalEmailSender,
      sessionService as unknown as PartnerPortalSessionService,
    ),
    sessionService,
    tokenCreate,
    tokenFindFirst,
    tokenFindUnique,
    tokenUpdateMany,
    transactionPortalUserFindUnique,
    transactionTokenFindFirst,
    transactionTokenUpdateMany,
  }
}

describe('PartnerPortalSignupService', () => {
  beforeEach(() => {
    jest.useRealTimers()
  })

  it('atomically creates a pending partner and first administrator, then sends a hash-only token', async () => {
    const harness = buildHarness()

    const result = await harness.service.signup(signupInput)

    expect(result).toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(harness.protectionService.assertSignupAllowed).toHaveBeenCalledWith({
      challengeToken: signupInput.challengeToken,
      clientIp: signupInput.clientIp,
      email: 'admin@atlas.example',
      honeypot: '',
      organization: 'atlaspayments\u001fbr',
    })
    expect(harness.databaseTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    expect(harness.partnerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        country: 'BR',
        email: 'admin@atlas.example',
        firstName: 'Ana',
        lastName: 'Silva',
        name: 'Atlas Payments',
      }),
    })
    expect(harness.portalUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'admin@atlas.example',
        emailVerificationRequiredAt: expect.any(Date),
        passwordVerifier: 'stored-scrypt-verifier',
        role: PartnerPortalRole.ADMIN,
      }),
    })
    const persistedTokenHash = String(harness.tokenCreate.mock.calls[0][0].data.tokenHash)
    const deliveredToken = harness.emailSender.sendVerificationEmail.mock.calls[0]?.[0].plaintextToken
    expect(persistedTokenHash).not.toBe(deliveredToken)
    expect(JSON.stringify(harness.partnerCreate.mock.calls[0]?.[0])).not.toContain(password)
    expect(JSON.stringify(harness.portalUserCreate.mock.calls[0]?.[0])).not.toContain(password)
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'signup.created' }),
      expect.anything(),
    )
    expect(harness.tokenUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ providerMessageId: 'resend-message-1' }),
    }))
  })

  it('returns the same acknowledgement for a duplicate without disclosing or emailing it', async () => {
    const harness = buildHarness()
    harness.databaseTransaction.mockRejectedValueOnce(prismaError('P2002'))
    harness.partnerFindUnique.mockResolvedValue(null)
    harness.partnerFindFirst.mockResolvedValueOnce(null)

    await expect(harness.service.signup(signupInput)).resolves.toEqual({
      status: 'VERIFICATION_REQUIRED',
    })

    expect(harness.emailSender.sendVerificationEmail).not.toHaveBeenCalled()
    expect(harness.partnerFindFirst).toHaveBeenCalledWith({
      where: {
        email: 'admin@atlas.example',
        publicSignupOrganizationHash: 'hash:organization:atlaspayments\u001fbr',
      },
    })
  })

  it('allows a credential-matching pending account to recover with a new idempotency key', async () => {
    const harness = buildHarness()
    harness.databaseTransaction.mockRejectedValueOnce(prismaError('P2002'))
    harness.partnerFindUnique.mockResolvedValue(null)
    harness.partnerFindFirst.mockResolvedValueOnce(buildPartner())

    const result = await harness.service.signup({
      ...signupInput,
      idempotencyKey: 'replacement-request-002',
    })

    expect(result).toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(harness.passwordService.verify).toHaveBeenCalledWith(
      password,
      'stored-scrypt-verifier',
    )
    expect(harness.emailSender.sendVerificationEmail).toHaveBeenCalledTimes(1)
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'signup.verification_email_requested' }),
      expect.anything(),
    )
  })

  it('does not resend when an idempotency replay changes fields or fails password verification', async () => {
    const harness = buildHarness()
    harness.partnerFindUnique.mockResolvedValueOnce(buildPartner())

    const fieldMismatch = await harness.service.signup({
      ...signupInput,
      company: 'Different Company',
    })

    expect(fieldMismatch).toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(harness.passwordService.performDummyVerification).toHaveBeenCalledWith(password)
    expect(harness.emailSender.sendVerificationEmail).not.toHaveBeenCalled()

    const wrongPasswordHarness = buildHarness()
    wrongPasswordHarness.partnerFindUnique.mockResolvedValueOnce(buildPartner())
    wrongPasswordHarness.passwordService.verify.mockResolvedValueOnce(false)
    const wrongPassword = await wrongPasswordHarness.service.signup(signupInput)
    expect(wrongPassword).toEqual({ status: 'VERIFICATION_REQUIRED' })
    expect(wrongPasswordHarness.emailSender.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('coalesces rapid exact retries and retries serializable transaction conflicts', async () => {
    const replayHarness = buildHarness()
    replayHarness.partnerFindUnique.mockResolvedValueOnce(buildPartner())
    replayHarness.tokenFindFirst.mockResolvedValueOnce(buildVerificationToken({
      createdAt: new Date(),
    }))

    await replayHarness.service.signup(signupInput)

    expect(replayHarness.emailSender.sendVerificationEmail).not.toHaveBeenCalled()
    expect(replayHarness.databaseTransaction).not.toHaveBeenCalled()

    const conflictHarness = buildHarness()
    conflictHarness.databaseTransaction.mockRejectedValueOnce(prismaError('P2034'))
    await conflictHarness.service.signup(signupInput)
    expect(conflictHarness.databaseTransaction).toHaveBeenCalledTimes(2)
    expect(conflictHarness.emailSender.sendVerificationEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps the pending account recoverable when the mail provider is unavailable', async () => {
    const harness = buildHarness()
    harness.emailSender.sendVerificationEmail.mockRejectedValueOnce(
      new PartnerPortalEmailDeliveryError('PROVIDER_UNAVAILABLE'),
    )

    await expect(harness.service.signup(signupInput)).resolves.toEqual({
      status: 'VERIFICATION_REQUIRED',
    })

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Partner signup verification email delivery failed',
      { code: 'PROVIDER_UNAVAILABLE' },
    )
    expect(JSON.stringify(harness.logger.warn.mock.calls)).not.toContain('admin@atlas.example')
    expect(JSON.stringify(harness.logger.warn.mock.calls)).not.toContain(password)
  })

  it('consumes one valid email token, records the bounded audit, and creates the normal session', async () => {
    const harness = buildHarness()
    const result = await harness.service.verifyEmail(
      signupInput.clientIp,
      'v'.repeat(43),
    )

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
      expect.objectContaining({
        action: 'signup.email_verified',
        actorUserId: buildPortalUser().id,
      }),
      expect.anything(),
    )
    expect(harness.sessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
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
    expect(expiredHarness.sessionService.createSession).not.toHaveBeenCalled()

    const consumedHarness = buildHarness()
    consumedHarness.transactionTokenUpdateMany.mockResolvedValueOnce({ count: 0 })
    await expect(consumedHarness.service.verifyEmail(
      signupInput.clientIp,
      'c'.repeat(43),
    )).rejects.toThrow(new PartnerPortalEmailVerificationError())
    expect(consumedHarness.sessionService.createSession).not.toHaveBeenCalled()
  })
})
