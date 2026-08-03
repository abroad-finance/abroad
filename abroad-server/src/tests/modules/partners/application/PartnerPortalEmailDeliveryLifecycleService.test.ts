import 'reflect-metadata'

import type { PartnerPortalEmailVerificationToken, PartnerPortalEmailWebhookEvent, PrismaClient } from '@prisma/client'

import { PartnerPortalEmailDeliveryStatus, Prisma } from '@prisma/client'

import { PartnerPortalEmailDeliveryLifecycleService } from '../../../../modules/partners/application/PartnerPortalEmailDeliveryLifecycleService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const now = new Date('2026-08-03T15:00:00.000Z')
const tokenId = '33333333-3333-4333-8333-333333333333'
const providerMessageId = 'resend-message-1'

const token = (
  overrides: Partial<PartnerPortalEmailVerificationToken> = {},
): PartnerPortalEmailVerificationToken => ({
  consumedAt: null,
  createdAt: now,
  deliveredAt: null,
  deliveryAttemptCount: 0,
  deliveryFailureCode: null,
  deliveryStatus: PartnerPortalEmailDeliveryStatus.PENDING,
  deliveryStatusUpdatedAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  id: tokenId,
  lastDeliveryAttemptAt: null,
  providerMessageId: null,
  sentAt: null,
  tokenCiphertext: 'v1.iv.tag.ciphertext',
  tokenHash: 'token-hash',
  userId: '22222222-2222-4222-8222-222222222222',
  ...overrides,
})

const webhookEvent = (
  overrides: Partial<PartnerPortalEmailWebhookEvent> = {},
): PartnerPortalEmailWebhookEvent => ({
  eventType: 'email.delivered',
  id: 'evt_111111111111111111111111',
  occurredAt: now,
  processedAt: null,
  providerMessageId,
  receivedAt: now,
  ...overrides,
})

const buildHarness = () => {
  const eventCreate = jest.fn(async () => webhookEvent())
  const eventFindMany = jest.fn(async () => [] as PartnerPortalEmailWebhookEvent[])
  const eventFindUnique = jest.fn(async () => null as null | PartnerPortalEmailWebhookEvent)
  const eventUpdate = jest.fn(async () => webhookEvent({ processedAt: now }))
  const eventUpdateMany = jest.fn(async () => ({ count: 1 }))
  const tokenFindUnique = jest.fn<
    Promise<null | PartnerPortalEmailVerificationToken>,
    [unknown]
  >(async () => token())
  const tokenUpdate = jest.fn(async () => token())
  const tokenUpdateMany = jest.fn(async () => ({ count: 1 }))
  const transactionClient = {
    partnerPortalEmailVerificationToken: {
      findUnique: tokenFindUnique,
      update: tokenUpdate,
      updateMany: tokenUpdateMany,
    },
    partnerPortalEmailWebhookEvent: {
      create: eventCreate,
      findMany: eventFindMany,
      findUnique: eventFindUnique,
      update: eventUpdate,
      updateMany: eventUpdateMany,
    },
  }
  const databaseClient = {
    $transaction: jest.fn(async (operation: (
      transaction: Prisma.TransactionClient,
    ) => Promise<unknown>) => operation(transactionClient as unknown as Prisma.TransactionClient)),
    partnerPortalEmailVerificationToken: {
      update: tokenUpdate,
      updateMany: tokenUpdateMany,
    },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => databaseClient as unknown as PrismaClient),
  }
  return {
    eventCreate,
    eventFindMany,
    eventFindUnique,
    eventUpdate,
    eventUpdateMany,
    service: new PartnerPortalEmailDeliveryLifecycleService(provider),
    tokenFindUnique,
    tokenUpdate,
    tokenUpdateMany,
  }
}

describe('PartnerPortalEmailDeliveryLifecycleService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('retains an early webhook and applies it when provider acceptance is persisted', async () => {
    const harness = buildHarness()
    harness.tokenFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(token())

    await harness.service.recordWebhook({
      eventId: webhookEvent().id,
      eventType: 'email.delivered',
      occurredAt: now,
      providerMessageId,
    })

    expect(harness.eventCreate).toHaveBeenCalledWith({
      data: {
        eventType: 'email.delivered',
        id: webhookEvent().id,
        occurredAt: now,
        providerMessageId,
      },
    })
    expect(harness.eventUpdate).not.toHaveBeenCalled()

    harness.eventFindMany.mockResolvedValueOnce([webhookEvent()])
    await harness.service.recordAccepted({ providerMessageId, tokenId })

    expect(harness.tokenUpdate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        deliveredAt: now,
        deliveryFailureCode: null,
        deliveryStatus: PartnerPortalEmailDeliveryStatus.DELIVERED,
        providerMessageId,
        tokenCiphertext: null,
      }),
      where: { id: tokenId },
    })
    expect(harness.eventUpdateMany).toHaveBeenCalledWith({
      data: { processedAt: now },
      where: { id: { in: [webhookEvent().id] } },
    })
  })

  it('is idempotent for duplicate provider events', async () => {
    const harness = buildHarness()
    harness.eventFindUnique.mockResolvedValueOnce(webhookEvent({ processedAt: now }))

    await harness.service.recordWebhook({
      eventId: webhookEvent().id,
      eventType: 'email.delivered',
      occurredAt: now,
      providerMessageId,
    })

    expect(harness.eventCreate).not.toHaveBeenCalled()
    expect(harness.tokenUpdate).not.toHaveBeenCalled()
  })

  it('does not downgrade delivered state when a delayed sent event arrives', async () => {
    const harness = buildHarness()
    harness.tokenFindUnique.mockResolvedValueOnce(token({
      deliveredAt: now,
      deliveryStatus: PartnerPortalEmailDeliveryStatus.DELIVERED,
      providerMessageId,
    }))

    await harness.service.recordWebhook({
      eventId: webhookEvent().id,
      eventType: 'email.sent',
      occurredAt: now,
      providerMessageId,
    })

    expect(harness.tokenUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deliveredAt: now,
        deliveryStatus: PartnerPortalEmailDeliveryStatus.DELIVERED,
      }),
      where: { id: tokenId },
    })
  })

  it('records attempts and distinguishes retryable from terminal delivery failures', async () => {
    const harness = buildHarness()

    await harness.service.recordAttempt(tokenId)
    expect(harness.tokenUpdate).toHaveBeenCalledWith({
      data: {
        deliveryAttemptCount: { increment: 1 },
        lastDeliveryAttemptAt: now,
      },
      where: { id: tokenId },
    })

    await harness.service.recordFailure({
      code: 'PROVIDER_UNAVAILABLE',
      terminal: false,
      tokenId,
    })
    await harness.service.recordFailure({
      code: 'PROVIDER_REJECTED',
      terminal: true,
      tokenId,
    })
    expect(harness.tokenUpdateMany).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        deliveryFailureCode: 'PROVIDER_UNAVAILABLE',
        deliveryStatus: PartnerPortalEmailDeliveryStatus.PENDING,
      }),
      where: { id: tokenId, providerMessageId: null },
    })
    expect(harness.tokenUpdateMany).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        deliveryFailureCode: 'PROVIDER_REJECTED',
        deliveryStatus: PartnerPortalEmailDeliveryStatus.FAILED,
        tokenCiphertext: null,
      }),
      where: { id: tokenId, providerMessageId: null },
    })
  })
})
