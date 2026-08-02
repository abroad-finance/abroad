import 'reflect-metadata'
import {
  BridgeLegStatus,
  CryptoCurrency,
  FlowInstanceStatus,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsOverviewService } from '../../../../modules/operations/application/OpsOverviewService'

type PrismaMock = {
  $queryRaw: jest.Mock
  flowInstance: { findFirst: jest.Mock, groupBy: jest.Mock }
  partner: { count: jest.Mock }
}

const NOW = new Date('2026-08-01T12:00:00.000Z')

const makeBridgeOverview = () => ({
  batches: [],
  float: { available: 88, cap: 100, deficit: 12, enabled: true },
  legs: {
    byStatus: [
      { amount: 7, count: 2, status: BridgeLegStatus.PENDING },
      { amount: 5, count: 1, status: BridgeLegStatus.BATCHED },
      { amount: 3, count: 1, status: BridgeLegStatus.FAILED },
    ],
    oldestPendingAt: new Date('2026-08-01T09:00:00.000Z'),
    recent: [],
    total: 4,
  },
})

const makePrisma = (): PrismaMock => ({
  $queryRaw: jest.fn(),
  flowInstance: {
    findFirst: jest.fn(async () => null),
    groupBy: jest.fn(async () => []),
  },
  partner: { count: jest.fn(async () => 0) },
})

const makeTreasuryBalances = () => ({
  capturedAt: new Date('2026-08-01T11:59:00.000Z'),
  cells: [
    {
      account: '', amount: 100, availableAmount: 100, blockedAmount: 0, currency: 'USDC', outstandingAmount: 0, posture: { alertPath: '/ops/treasury', averageDailyOutflow: null, ownerTeam: null, runwayHours: null, state: 'UNCONFIGURED', threshold: null }, reservedAmount: 0, usdRate: 1, usdValue: 100, venue: 'BINANCE',
    },
    {
      account: '', amount: 500, availableAmount: 500, blockedAmount: 0, currency: 'BRL', outstandingAmount: 0, posture: { alertPath: '/ops/treasury', averageDailyOutflow: null, ownerTeam: null, runwayHours: null, state: 'UNCONFIGURED', threshold: null }, reservedAmount: 0, usdRate: null, usdValue: null, venue: 'TRANSFERO',
    },
  ],
  errors: [{ message: 'Unavailable', venue: 'STELLAR_HOT_WALLET' }],
  float: { available: 88, cap: 100, deficit: 12, enabled: true },
  freshness: { staleAt: new Date('2026-08-01T12:01:00.000Z'), state: 'PARTIAL' },
  fxRates: [],
  totalUsd: 100,
  totalUsdIsPartial: true,
})

const makeService = (prisma: PrismaMock) => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const bridgeService = { getOverview: jest.fn(async () => makeBridgeOverview()) }
  const treasuryService = { getBalances: jest.fn(async () => makeTreasuryBalances()) }
  const incidentService = {
    getOverviewInternal: jest.fn(async () => ({
      critical: 1,
      high: 2,
      open: 4,
      top: [],
      unowned: 3,
    })),
  }

  return {
    bridgeService,
    incidentService,
    service: new OpsOverviewService(
      dbProvider,
      bridgeService as never,
      treasuryService as never,
      incidentService as never,
    ),
    treasuryService,
  }
}

describe('OpsOverviewService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('composes exact activity, partner, execution, treasury, and bridge summaries', async () => {
    const prisma = makePrisma()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          bucket: new Date('2026-08-01T00:00:00.000Z'),
          cryptoCurrency: CryptoCurrency.USDC,
          payoutAmount: 2_000,
          period: 'CURRENT',
          sourceAmount: 400,
          status: TransactionStatus.PAYMENT_COMPLETED,
          targetCurrency: TargetCurrency.BRL,
          transactionCount: 4,
        },
        {
          bucket: new Date('2026-08-01T00:00:00.000Z'),
          cryptoCurrency: CryptoCurrency.USDC,
          payoutAmount: 500,
          period: 'CURRENT',
          sourceAmount: 100,
          status: TransactionStatus.PAYMENT_FAILED,
          targetCurrency: TargetCurrency.BRL,
          transactionCount: 1,
        },
        {
          bucket: new Date('2026-08-01T00:00:00.000Z'),
          cryptoCurrency: CryptoCurrency.USDT,
          payoutAmount: 1_000,
          period: 'CURRENT',
          sourceAmount: 200,
          status: TransactionStatus.PROCESSING_PAYMENT,
          targetCurrency: TargetCurrency.BRL,
          transactionCount: 2,
        },
        {
          bucket: new Date('2026-08-01T00:00:00.000Z'),
          cryptoCurrency: CryptoCurrency.USDT,
          payoutAmount: 500,
          period: 'CURRENT',
          sourceAmount: 100,
          status: TransactionStatus.WRONG_AMOUNT,
          targetCurrency: TargetCurrency.BRL,
          transactionCount: 1,
        },
        {
          bucket: new Date('2026-07-24T00:00:00.000Z'),
          cryptoCurrency: CryptoCurrency.USDT,
          payoutAmount: 900,
          period: 'PREVIOUS',
          sourceAmount: 180,
          status: TransactionStatus.PAYMENT_COMPLETED,
          targetCurrency: TargetCurrency.BRL,
          transactionCount: 2,
        },
      ])
      .mockResolvedValueOnce([
        {
          activePartnerCount: 3,
          completedTransactions: 5,
          id: 'partner-1',
          name: 'Acme',
          stablecoinAmount: 450,
          totalTransactions: 8,
          usdcAmount: 400,
          usdtAmount: 50,
        },
      ])
    prisma.partner.count.mockResolvedValue(12)
    prisma.flowInstance.groupBy.mockResolvedValue([
      { _count: { _all: 2 }, status: FlowInstanceStatus.WAITING },
      { _count: { _all: 1 }, status: FlowInstanceStatus.FAILED },
    ])
    prisma.flowInstance.findFirst.mockResolvedValue({ updatedAt: new Date('2026-08-01T08:00:00.000Z') })
    const {
      bridgeService,
      incidentService,
      service,
      treasuryService,
    } = makeService(prisma)

    const result = await service.getOverview('7d')

    expect(result.generatedAt).toEqual(NOW)
    expect(result.window).toEqual({
      from: new Date('2026-07-25T12:00:00.000Z'),
      previousFrom: new Date('2026-07-18T12:00:00.000Z'),
      previousTo: new Date('2026-07-25T12:00:00.000Z'),
      range: '7d',
      to: NOW,
    })
    expect(result.activity.current).toMatchObject({
      completedTransactions: 4,
      payoutVolume: [{ amount: 2_000, currency: TargetCurrency.BRL }],
      sourceVolume: [{ amount: 400, currency: CryptoCurrency.USDC }],
      successRatePct: 66.67,
      totalTransactions: 8,
    })
    expect(result.activity.previous).toMatchObject({
      completedTransactions: 2,
      payoutVolume: [{ amount: 900, currency: TargetCurrency.BRL }],
      sourceVolume: [{ amount: 180, currency: CryptoCurrency.USDT }],
      successRatePct: 100,
      totalTransactions: 2,
    })
    expect(result.activity.seriesUnit).toBe('DAY')
    expect(result.activity.series).toHaveLength(8)
    expect(result.activity.series.find(point => point.at.toISOString() === '2026-08-01T00:00:00.000Z')).toEqual({
      at: new Date('2026-08-01T00:00:00.000Z'),
      completedTransactions: 4,
      expiredTransactions: 0,
      failedTransactions: 2,
      openTransactions: 2,
      totalTransactions: 8,
    })
    expect(result.partners).toEqual({
      activePartners: 3,
      top: [{
        completedTransactions: 5,
        id: 'partner-1',
        name: 'Acme',
        sourceVolume: [
          { amount: 400, currency: CryptoCurrency.USDC },
          { amount: 50, currency: CryptoCurrency.USDT },
        ],
        stablecoinAmount: 450,
        totalTransactions: 8,
      }],
      totalPartners: 12,
    })
    expect(result.execution).toEqual({
      oldestWaitingAt: new Date('2026-08-01T08:00:00.000Z'),
      statusCounts: [
        { count: 0, status: FlowInstanceStatus.NOT_STARTED },
        { count: 0, status: FlowInstanceStatus.IN_PROGRESS },
        { count: 2, status: FlowInstanceStatus.WAITING },
        { count: 1, status: FlowInstanceStatus.FAILED },
        { count: 0, status: FlowInstanceStatus.COMPLETED },
      ],
      totalFlows: 3,
    })
    expect(result.treasury).toEqual({
      capturedAt: new Date('2026-08-01T11:59:00.000Z'),
      totalUsd: 100,
      totalUsdIsPartial: true,
      venues: { reporting: 2, total: 3, unavailable: 1 },
    })
    expect(result.incidents).toEqual({ critical: 1, high: 2, open: 4, top: [], unowned: 3 })
    expect(result.bridge).toEqual({
      failedLegs: { amount: 3, count: 1 },
      float: { available: 88, cap: 100, deficit: 12, enabled: true },
      oldestPendingAt: new Date('2026-08-01T09:00:00.000Z'),
      outstandingLegs: { amount: 12, count: 3 },
    })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(bridgeService.getOverview).toHaveBeenCalledTimes(1)
    expect(treasuryService.getBalances).toHaveBeenCalledTimes(1)
    expect(incidentService.getOverviewInternal).toHaveBeenCalledTimes(1)
  })

  it('returns a gap-filled hourly series and null outcome rate when the window is empty', async () => {
    const prisma = makePrisma()
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const { service } = makeService(prisma)

    const result = await service.getOverview('24h')

    expect(result.activity.current.totalTransactions).toBe(0)
    expect(result.activity.current.successRatePct).toBeNull()
    expect(result.activity.current.statusCounts).toHaveLength(6)
    expect(result.activity.current.statusCounts.every(entry => entry.count === 0)).toBe(true)
    expect(result.activity.seriesUnit).toBe('HOUR')
    expect(result.activity.series).toHaveLength(24)
    expect(result.activity.series.every(point => point.totalTransactions === 0)).toBe(true)
    expect(result.partners).toEqual({ activePartners: 0, top: [], totalPartners: 0 })
  })
})
