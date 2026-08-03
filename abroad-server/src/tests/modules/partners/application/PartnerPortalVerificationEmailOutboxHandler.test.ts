import 'reflect-metadata'
import { PartnerPortalEmailDeliveryStatus, PartnerPortalRole, PrismaClient } from '@prisma/client'

import { PartnerPortalEmailDeliveryLifecycleService } from '../../../../modules/partners/application/PartnerPortalEmailDeliveryLifecycleService'
import { PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND, PartnerPortalVerificationEmailOutboxHandler } from '../../../../modules/partners/application/PartnerPortalVerificationEmailOutboxHandler'
import { PartnerPortalEmailDeliveryError, ResendPartnerPortalEmailSender } from '../../../../modules/partners/application/ResendPartnerPortalEmailSender'
import { OutboxDeliveryError } from '../../../../platform/outbox/OutboxDeliveryHandler'
import { OutboxRecord } from '../../../../platform/outbox/OutboxRepository'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const now = new Date('2026-08-03T15:00:00.000Z')
const tokenId = '33333333-3333-4333-8333-333333333333'

const record = (overrides: Partial<OutboxRecord> = {}): OutboxRecord => ({
  attempts: 0,
  availableAt: now,
  createdAt: now,
  id: '44444444-4444-4444-8444-444444444444',
  idempotencyKey: `partner-signup-email/${tokenId}`,
  initiatedByPortalUserId: null,
  lastAttemptDurationMs: null,
  lastError: null,
  lastHttpStatus: null,
  maxAttempts: 5,
  partnerId: '11111111-1111-4111-8111-111111111111',
  payload: { kind: PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND, tokenId },
  sourceOutboxEventId: null,
  status: 'PENDING',
  transactionId: null,
  type: PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND,
  updatedAt: now,
  webhookCredentialMode: null,
  webhookEvent: null,
  webhookPurpose: null,
  ...overrides,
})

const buildToken = (overrides: Record<string, unknown> = {}) => ({
  consumedAt: null,
  createdAt: now,
  deliveredAt: null,
  deliveryAttemptCount: 0,
  deliveryFailureCode: null,
  deliveryStatus: PartnerPortalEmailDeliveryStatus.PENDING,
  deliveryStatusUpdatedAt: now,
  expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
  id: tokenId,
  lastDeliveryAttemptAt: null,
  providerMessageId: null,
  sentAt: null,
  tokenCiphertext: 'v1.iv.tag.ciphertext',
  tokenHash: 'token-hash',
  user: {
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
    partner: { firstName: 'Ana' },
    partnerId: '11111111-1111-4111-8111-111111111111',
    passwordVerifier: 'password-verifier',
    role: PartnerPortalRole.ADMIN,
    sessionVersion: 1,
    updatedAt: now,
  },
  userId: '22222222-2222-4222-8222-222222222222',
  ...overrides,
})

const buildHarness = () => {
  const findUnique = jest.fn(async () => buildToken())
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      partnerPortalEmailVerificationToken: { findUnique },
    }) as unknown as PrismaClient),
  }
  const lifecycleService = {
    recordAccepted: jest.fn(async () => undefined),
    recordAttempt: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => undefined),
  }
  const secretEnvelopeService = {
    decrypt: jest.fn(async () => 'v'.repeat(43)),
  }
  const emailSender = {
    sendVerificationEmail: jest.fn(async () => ({ providerMessageId: 'resend-message-1' })),
  }
  return {
    emailSender,
    findUnique,
    handler: new PartnerPortalVerificationEmailOutboxHandler(
      databaseClientProvider,
      lifecycleService as unknown as PartnerPortalEmailDeliveryLifecycleService,
      secretEnvelopeService as unknown as PartnerPortalSecretEnvelopeService,
      emailSender as unknown as ResendPartnerPortalEmailSender,
    ),
    lifecycleService,
    secretEnvelopeService,
  }
}

describe('PartnerPortalVerificationEmailOutboxHandler', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('decrypts and sends an eligible job, then records provider acceptance', async () => {
    const harness = buildHarness()

    await harness.handler.deliver(record())

    expect(harness.lifecycleService.recordAttempt).toHaveBeenCalledWith(tokenId)
    expect(harness.secretEnvelopeService.decrypt).toHaveBeenCalledWith(
      'v1.iv.tag.ciphertext',
      `partner-portal-email-verification:${tokenId}`,
    )
    expect(harness.emailSender.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'admin@atlas.example',
      firstName: 'Ana',
      plaintextToken: 'v'.repeat(43),
      tokenId,
    })
    expect(harness.lifecycleService.recordAccepted).toHaveBeenCalledWith({
      providerMessageId: 'resend-message-1',
      tokenId,
    })
  })

  it('does not repeat a provider-accepted mutation after an outbox acknowledgement loss', async () => {
    const harness = buildHarness()
    harness.findUnique.mockResolvedValueOnce(buildToken({
      providerMessageId: 'resend-message-1',
      tokenCiphertext: null,
    }))

    await harness.handler.deliver(record({ attempts: 1 }))

    expect(harness.lifecycleService.recordAttempt).not.toHaveBeenCalled()
    expect(harness.emailSender.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('marks provider rejection terminal and transient exhaustion retryable', async () => {
    const rejectedHarness = buildHarness()
    rejectedHarness.emailSender.sendVerificationEmail.mockRejectedValueOnce(
      new PartnerPortalEmailDeliveryError('PROVIDER_REJECTED'),
    )

    await expect(rejectedHarness.handler.deliver(record())).rejects.toEqual(
      expect.objectContaining<Partial<OutboxDeliveryError>>({ retryable: false }),
    )
    expect(rejectedHarness.lifecycleService.recordFailure).toHaveBeenCalledWith({
      code: 'PROVIDER_REJECTED',
      terminal: true,
      tokenId,
    })

    const transientHarness = buildHarness()
    transientHarness.emailSender.sendVerificationEmail.mockRejectedValueOnce(
      new PartnerPortalEmailDeliveryError('PROVIDER_UNAVAILABLE'),
    )
    await expect(transientHarness.handler.deliver(record({ attempts: 1 }))).rejects.toEqual(
      expect.objectContaining<Partial<OutboxDeliveryError>>({ retryable: true }),
    )
    expect(transientHarness.lifecycleService.recordFailure).toHaveBeenCalledWith({
      code: 'PROVIDER_UNAVAILABLE',
      terminal: false,
      tokenId,
    })
  })

  it('rejects malformed or ineligible jobs before provider delivery', async () => {
    const malformedHarness = buildHarness()
    await expect(malformedHarness.handler.deliver(record({
      payload: { email: 'admin@atlas.example', kind: PARTNER_PORTAL_VERIFICATION_EMAIL_OUTBOX_KIND },
    }))).rejects.toEqual(expect.objectContaining<Partial<OutboxDeliveryError>>({ retryable: false }))
    expect(malformedHarness.findUnique).not.toHaveBeenCalled()

    const ineligibleHarness = buildHarness()
    ineligibleHarness.findUnique.mockResolvedValueOnce(buildToken({ consumedAt: now }))
    await expect(ineligibleHarness.handler.deliver(record())).rejects.toEqual(
      expect.objectContaining<Partial<OutboxDeliveryError>>({ retryable: false }),
    )
    expect(ineligibleHarness.lifecycleService.recordFailure).toHaveBeenCalledWith({
      code: 'DELIVERY_NOT_ELIGIBLE',
      terminal: true,
      tokenId,
    })
    expect(ineligibleHarness.emailSender.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
