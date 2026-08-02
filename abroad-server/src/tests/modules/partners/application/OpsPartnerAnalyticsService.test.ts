import 'reflect-metadata'
import {
  CryptoCurrency,
  OpsIncidentSeverity,
  OpsWorkStatus,
  OutboxStatus,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsPartnerAnalyticsService } from '../../../../modules/partners/application/OpsPartnerAnalyticsService'

const partnerA = {
  apiKey: 'hashed',
  country: 'CO',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  id: 'partner-a',
  isKybApproved: true,
  name: 'Alpha',
  portalApiKeys: [],
}

const partnerB = {
  apiKey: null,
  country: 'BR',
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  id: 'partner-b',
  isKybApproved: false,
  name: 'Beta',
  portalApiKeys: [],
}

describe('OpsPartnerAnalyticsService', () => {
  it('filters and ranks a currency-safe partner directory for the selected range', async () => {
    const queryRaw = jest.fn().mockResolvedValueOnce([
      {
        count: 4,
        cryptoCurrency: CryptoCurrency.USDC,
        partnerId: partnerA.id,
        sourceAmount: 100,
        status: TransactionStatus.PAYMENT_COMPLETED,
        targetAmount: 500,
        targetCurrency: TargetCurrency.BRL,
      },
      {
        count: 1,
        cryptoCurrency: CryptoCurrency.USDT,
        partnerId: partnerA.id,
        sourceAmount: 20,
        status: TransactionStatus.PAYMENT_COMPLETED,
        targetAmount: 80,
        targetCurrency: TargetCurrency.BRL,
      },
      {
        count: 1,
        cryptoCurrency: CryptoCurrency.USDC,
        partnerId: partnerA.id,
        sourceAmount: 10,
        status: TransactionStatus.PAYMENT_FAILED,
        targetAmount: 50,
        targetCurrency: TargetCurrency.BRL,
      },
    ])
    const partnerFindMany = jest.fn(async () => [partnerB, partnerA])
    const provider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => ({
        $queryRaw: queryRaw,
        partner: { findMany: partnerFindMany },
      }) as unknown as import('@prisma/client').PrismaClient),
    }
    const service = new OpsPartnerAnalyticsService(provider)

    const result = await service.listDirectory({
      activity: 'ACTIVE',
      page: 1,
      pageSize: 20,
      range: '30d',
    })

    expect(result.items).toEqual([
      expect.objectContaining({
        completedTransactions: 5,
        failedTransactions: 1,
        id: partnerA.id,
        lifecycle: 'LIVE',
        payoutVolume: [{ amount: 580, currency: 'BRL' }],
        sourceVolume: [
          { amount: 100, currency: 'USDC' },
          { amount: 20, currency: 'USDT' },
        ],
        stablecoinAmount: 120,
        successRatePct: 83.333333,
        totalTransactions: 6,
      }),
    ])
    expect(result.total).toBe(1)
    expect(result.maximumStablecoinAmount).toBe(120)
    expect(result.filterOptions.countries).toEqual(['BR', 'CO'])
    expect(partnerFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ portalApiKeys: expect.any(Object) }),
    }))
  })

  it('builds a partner scorecard with outcomes, webhook health, concentration, incidents, and cases', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([
        {
          count: 3,
          cryptoCurrency: CryptoCurrency.USDC,
          partnerId: partnerA.id,
          sourceAmount: 60,
          status: TransactionStatus.PAYMENT_COMPLETED,
          targetAmount: 300,
          targetCurrency: TargetCurrency.BRL,
        },
        {
          count: 1,
          cryptoCurrency: CryptoCurrency.USDC,
          partnerId: partnerA.id,
          sourceAmount: 20,
          status: TransactionStatus.PAYMENT_EXPIRED,
          targetAmount: 100,
          targetCurrency: TargetCurrency.BRL,
        },
      ])
      .mockResolvedValueOnce([
        { at: new Date('2026-08-01T00:00:00.000Z'), count: 3, status: TransactionStatus.PAYMENT_COMPLETED },
        { at: new Date('2026-08-01T00:00:00.000Z'), count: 1, status: TransactionStatus.PAYMENT_EXPIRED },
      ])
      .mockResolvedValueOnce([
        {
          blockchain: 'POLYGON',
          completedTransactions: 3,
          cryptoCurrency: CryptoCurrency.USDC,
          sourceAmount: 60,
          targetCurrency: TargetCurrency.BRL,
        },
      ])
    const provider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => ({
        $queryRaw: queryRaw,
        opsCase: {
          groupBy: jest.fn(async () => [{ _count: { _all: 1 }, status: OpsWorkStatus.OPEN }]),
        },
        opsIncident: {
          findMany: jest.fn(async () => [{
            context: { affected: [{ id: partnerA.id, type: 'PARTNER' }] },
            id: 'incident-1',
            severity: OpsIncidentSeverity.HIGH,
            status: OpsWorkStatus.OPEN,
            title: 'Webhook delivery is degraded',
          }]),
        },
        outboxEvent: {
          findFirst: jest.fn(async () => ({ updatedAt: new Date('2026-08-01T12:00:00.000Z') })),
          groupBy: jest.fn(async () => [
            { _count: { _all: 9 }, status: OutboxStatus.DELIVERED },
            { _count: { _all: 1 }, status: OutboxStatus.FAILED },
          ]),
        },
        partner: { findUnique: jest.fn(async () => partnerA) },
      }) as unknown as import('@prisma/client').PrismaClient),
    }
    const service = new OpsPartnerAnalyticsService(provider)

    const result = await service.getScorecard(partnerA.id, '7d')

    expect(result.activity).toEqual(expect.objectContaining({
      completedTransactions: 3,
      failedTransactions: 1,
      stablecoinAmount: 60,
      successRatePct: 75,
      totalTransactions: 4,
    }))
    expect(result.webhook).toEqual(expect.objectContaining({
      delivered: 9,
      failed: 1,
      successRatePct: 90,
    }))
    expect(result.corridors[0]).toEqual(expect.objectContaining({ sharePct: 100 }))
    expect(result.incidents[0]).toEqual(expect.objectContaining({ href: '/ops/incidents/incident-1' }))
    expect(result.cases).toEqual([{ count: 1, status: OpsWorkStatus.OPEN }])
    expect(result.transactionPath).toContain(`partnerId=${partnerA.id}`)
  })
})
