import 'reflect-metadata'

import type { OutboxEvent, PrismaClient } from '@prisma/client'

import {
  OutboxStatus,
  PartnerPortalRole,
  Prisma,
  WebhookCredentialMode,
  WebhookDeliveryPurpose,
} from '@prisma/client'

import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerWebhookRedeliveryNotFoundError, PartnerWebhookRedeliveryService, PartnerWebhookRedeliveryValidationError } from '../../../../modules/transactions/application/PartnerWebhookRedeliveryService'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type SourceOutboxEvent = OutboxEvent & {
  _count: { redeliveries: number }
  redeliveries: Array<{ createdAt: Date }>
}
type TransactionCallback = (transaction: Prisma.TransactionClient) => Promise<unknown>

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@decaf.so',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner: { id: 'partner-1', name: 'Decaf' } as PartnerPortalPrincipal['partner'],
  role: PartnerPortalRole.ADMIN,
  userId: 'user-1',
}

const outboxEvent = (overrides: Partial<OutboxEvent> = {}): OutboxEvent => ({
  attempts: 5,
  availableAt: new Date('2026-08-01T12:00:00.000Z'),
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  id: 'source-delivery-1',
  idempotencyKey: null,
  initiatedByPortalUserId: null,
  lastAttemptDurationMs: 250,
  lastError: 'Webhook delivery failed',
  lastHttpStatus: 503,
  maxAttempts: 5,
  partnerId: principal.partner.id,
  payload: {
    kind: 'webhook',
    payload: {
      data: { id: 'transaction-1', status: 'PAYMENT_COMPLETED' },
      event: WebhookEvent.TRANSACTION_UPDATED,
    },
    target: 'https://hooks.partner.example/old',
  },
  sourceOutboxEventId: null,
  status: OutboxStatus.FAILED,
  transactionId: 'transaction-1',
  type: 'webhook',
  updatedAt: new Date('2026-08-01T12:00:01.000Z'),
  webhookCredentialMode: WebhookCredentialMode.PARTNER_CURRENT,
  webhookEvent: WebhookEvent.TRANSACTION_UPDATED,
  webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
  ...overrides,
})

const buildHarness = (managedSecret = true) => {
  const existingFindUnique = jest.fn<Promise<null | OutboxEvent>, [unknown]>(async () => null)
  const sourceFindFirst = jest.fn<Promise<null | SourceOutboxEvent>, [unknown]>(
    async () => ({
      ...outboxEvent(),
      _count: { redeliveries: 0 },
      redeliveries: [],
    }),
  )
  const partnerFindUnique = jest.fn(async () => ({
    webhookConfiguration: managedSecret
      ? { activeSecretCiphertext: 'active-envelope' }
      : null,
    webhookUrl: 'https://hooks.partner.example/current',
  }))
  const transactionClient = {
    outboxEvent: {
      findFirst: sourceFindFirst,
      findUnique: existingFindUnique,
    },
    partner: { findUnique: partnerFindUnique },
  }
  const databaseTransaction = jest.fn<Promise<unknown>, [TransactionCallback, unknown]>(
    async callback => callback(transactionClient as unknown as Prisma.TransactionClient),
  )
  const resultFindUnique = jest.fn(async () => outboxEvent({
    attempts: 1,
    id: 'redelivery-1',
    idempotencyKey: `partner-redelivery:${principal.partner.id}:request-1234`,
    lastAttemptDurationMs: 90,
    lastError: null,
    lastHttpStatus: 204,
    sourceOutboxEventId: 'source-delivery-1',
    status: OutboxStatus.DELIVERED,
    webhookPurpose: WebhookDeliveryPurpose.REDELIVERY,
  }))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      $transaction: databaseTransaction,
      outboxEvent: { findUnique: resultFindUnique },
    }) as unknown as PrismaClient),
  }
  const createdRecord = outboxEvent({
    attempts: 0,
    id: 'redelivery-1',
    idempotencyKey: `partner-redelivery:${principal.partner.id}:request-1234`,
    maxAttempts: 5,
    sourceOutboxEventId: 'source-delivery-1',
    status: OutboxStatus.PENDING,
    webhookPurpose: WebhookDeliveryPurpose.REDELIVERY,
  })
  const enqueueWebhook = jest.fn(async () => createdRecord)
  const deliver = jest.fn(async () => undefined)
  const auditRecord = jest.fn(async () => undefined)

  return {
    auditRecord,
    databaseTransaction,
    deliver,
    enqueueWebhook,
    existingFindUnique,
    partnerFindUnique,
    resultFindUnique,
    service: new PartnerWebhookRedeliveryService(
      databaseClientProvider,
      { deliver, enqueueWebhook } as unknown as OutboxDispatcher,
      { record: auditRecord } as unknown as PartnerPortalAuditService,
    ),
    sourceFindFirst,
  }
}

describe('PartnerWebhookRedeliveryService', () => {
  it('creates one callback-only redelivery with tenant ownership and current credentials', async () => {
    const harness = buildHarness()

    const result = await harness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )

    expect(harness.databaseTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    expect(harness.sourceFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'source-delivery-1',
        partnerId: principal.partner.id,
        transactionId: 'transaction-1',
        webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
      }),
    }))
    expect(harness.enqueueWebhook).toHaveBeenCalledWith(
      'https://hooks.partner.example/current',
      {
        data: { id: 'transaction-1', status: 'PAYMENT_COMPLETED' },
        event: WebhookEvent.TRANSACTION_UPDATED,
      },
      'partner-portal:webhook-redelivery',
      expect.objectContaining({
        deliverNow: false,
        metadata: {
          idempotencyKey: `partner-redelivery:${principal.partner.id}:request-1234`,
          initiatedByPortalUserId: principal.userId,
          maxAttempts: 5,
          partnerId: principal.partner.id,
          sourceOutboxEventId: 'source-delivery-1',
          transactionId: 'transaction-1',
          webhookCredentialMode: WebhookCredentialMode.PARTNER_CURRENT,
          webhookPurpose: WebhookDeliveryPurpose.REDELIVERY,
        },
      }),
    )
    expect(harness.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'redelivery-1' }),
      'partner-portal:webhook-redelivery',
    )
    expect(result).toEqual({
      alreadyExisted: false,
      attempts: 1,
      deliveryId: 'redelivery-1',
      durationMs: 90,
      httpStatus: 204,
      status: OutboxStatus.DELIVERED,
    })
  })

  it('uses the legacy origin credential only for partners without a managed active secret', async () => {
    const harness = buildHarness(false)

    await harness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )

    expect(harness.enqueueWebhook).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        metadata: expect.objectContaining({
          webhookCredentialMode: WebhookCredentialMode.LEGACY_ORIGIN,
        }),
      }),
    )
  })

  it('returns the existing tenant-owned idempotent redelivery without sending again', async () => {
    const harness = buildHarness()
    harness.existingFindUnique.mockResolvedValueOnce(outboxEvent({
      id: 'redelivery-existing',
      idempotencyKey: `partner-redelivery:${principal.partner.id}:request-1234`,
      sourceOutboxEventId: 'source-delivery-1',
      status: OutboxStatus.DELIVERED,
    }))
    harness.resultFindUnique.mockResolvedValueOnce(outboxEvent({
      attempts: 1,
      id: 'redelivery-existing',
      sourceOutboxEventId: 'source-delivery-1',
      status: OutboxStatus.DELIVERED,
    }))

    const result = await harness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )

    expect(result.alreadyExisted).toBe(true)
    expect(harness.sourceFindFirst).not.toHaveBeenCalled()
    expect(harness.enqueueWebhook).not.toHaveBeenCalled()
    expect(harness.deliver).not.toHaveBeenCalled()
  })

  it('rejects cross-tenant, nonfailed, capped, and cooldown-ineligible sources', async () => {
    const missingHarness = buildHarness()
    missingHarness.sourceFindFirst.mockResolvedValueOnce(null)
    await expect(missingHarness.service.redeliver(
      principal,
      'transaction-1',
      'other-tenant-delivery',
      'request-1234',
    )).rejects.toThrow(new PartnerWebhookRedeliveryNotFoundError())

    const deliveredHarness = buildHarness()
    deliveredHarness.sourceFindFirst.mockResolvedValueOnce({
      ...outboxEvent({ status: OutboxStatus.DELIVERED }),
      _count: { redeliveries: 0 },
      redeliveries: [],
    })
    await expect(deliveredHarness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )).rejects.toThrow('Only a failed original webhook delivery can be redelivered')

    const cappedHarness = buildHarness()
    cappedHarness.sourceFindFirst.mockResolvedValueOnce({
      ...outboxEvent(),
      _count: { redeliveries: 3 },
      redeliveries: [],
    })
    await expect(cappedHarness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )).rejects.toThrow('This webhook delivery has reached its redelivery limit')

    const cooldownHarness = buildHarness()
    cooldownHarness.sourceFindFirst.mockResolvedValueOnce({
      ...outboxEvent(),
      _count: { redeliveries: 1 },
      redeliveries: [{ createdAt: new Date() }],
    })
    await expect(cooldownHarness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )).rejects.toThrow('Wait one minute before redelivering this webhook again')
  })

  it('rejects invalid idempotency keys, conflicting ownership, and nontransaction payloads', async () => {
    const invalidHarness = buildHarness()
    await expect(invalidHarness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'short',
    )).rejects.toThrow(new PartnerWebhookRedeliveryValidationError(
      'Idempotency-Key must contain 8-128 letters, numbers, dots, underscores, colons, or hyphens',
    ))

    const conflictHarness = buildHarness()
    conflictHarness.existingFindUnique.mockResolvedValueOnce(outboxEvent({
      partnerId: 'other-partner',
      sourceOutboxEventId: 'source-delivery-1',
    }))
    await expect(conflictHarness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )).rejects.toThrow('Idempotency key is already in use')

    const payloadHarness = buildHarness()
    payloadHarness.sourceFindFirst.mockResolvedValueOnce({
      ...outboxEvent({ payload: { kind: 'queue' } }),
      _count: { redeliveries: 0 },
      redeliveries: [],
    })
    await expect(payloadHarness.service.redeliver(
      principal,
      'transaction-1',
      'source-delivery-1',
      'request-1234',
    )).rejects.toThrow('Webhook payload is unavailable')
  })
})
