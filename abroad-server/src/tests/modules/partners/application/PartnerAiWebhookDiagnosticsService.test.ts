import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { OutboxStatus, WebhookDeliveryPurpose } from '@prisma/client'

import { PartnerAiWebhookDiagnosticsService } from '../../../../modules/partners/application/PartnerAiWebhookDiagnosticsService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const now = new Date('2026-08-02T18:00:00.000Z')

const buildHarness = (webhookUrl: null | string = 'https://hooks.partner.example/private/path?token=hidden') => {
  const partnerFindUnique = jest.fn(async () => ({ webhookUrl }))
  const groupBy = jest.fn(async () => [
    { _count: { _all: 3 }, status: OutboxStatus.DELIVERED },
    { _count: { _all: 1 }, status: OutboxStatus.FAILED },
  ])
  const findFirst = jest.fn(async (): Promise<null | {
    lastAttemptDurationMs: number
    lastHttpStatus: number
    status: OutboxStatus
    updatedAt: Date
  }> => ({
    lastAttemptDurationMs: 420,
    lastHttpStatus: 404,
    status: OutboxStatus.FAILED,
    updatedAt: new Date('2026-08-02T17:50:00.000Z'),
  }))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      outboxEvent: { findFirst, groupBy },
      partner: { findUnique: partnerFindUnique },
    }) as unknown as PrismaClient),
  }
  return {
    findFirst,
    groupBy,
    partnerFindUnique,
    service: new PartnerAiWebhookDiagnosticsService(databaseClientProvider),
  }
}

describe('PartnerAiWebhookDiagnosticsService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns host-only, transaction-delivery aggregates for the authenticated tenant', async () => {
    const harness = buildHarness()

    const result = await harness.service.get('partner-1', 24)

    const expectedWhere = {
      partnerId: 'partner-1',
      updatedAt: { gte: new Date('2026-08-01T18:00:00.000Z') },
      webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
    }
    expect(harness.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(harness.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      where: expectedWhere,
    }))
    expect(result).toEqual({
      configured: true,
      deliveries: [
        { count: 0, status: OutboxStatus.PENDING },
        { count: 0, status: OutboxStatus.DELIVERING },
        { count: 3, status: OutboxStatus.DELIVERED },
        { count: 1, status: OutboxStatus.FAILED },
      ],
      destinationHost: 'hooks.partner.example',
      latest: {
        attemptedAt: new Date('2026-08-02T17:50:00.000Z'),
        durationMs: 420,
        failureCode: 'HTTP_REJECTED',
        httpStatus: 404,
        status: OutboxStatus.FAILED,
      },
      lookbackHours: 24,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('/private/path')
    expect(serialized).not.toContain('token=hidden')
  })

  it('does not expose malformed destinations or fabricate delivery evidence', async () => {
    const harness = buildHarness('not a URL')
    harness.groupBy.mockResolvedValueOnce([])
    harness.findFirst.mockResolvedValueOnce(null)

    await expect(harness.service.get('partner-1', 1)).resolves.toEqual(expect.objectContaining({
      configured: true,
      destinationHost: null,
      latest: null,
    }))
  })
})
