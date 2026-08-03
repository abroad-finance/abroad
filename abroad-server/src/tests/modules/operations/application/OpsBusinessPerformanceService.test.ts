import {
  CryptoCurrency,
  EconomicConversionStatus,
  EconomicFactCoverageStatus,
  Prisma,
  QuoteRequestOutcome,
  TargetCurrency,
  TransactionEconomicCostKind,
  TransactionEconomicCostStatus,
  TransactionStatus,
} from '@prisma/client'

import { OpsBusinessPerformanceService } from '../../../../modules/operations/application/OpsBusinessPerformanceService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const decimal = (value: number | string) => new Prisma.Decimal(String(value))

const settledEconomics = (costs: Array<{
  kind: TransactionEconomicCostKind
  status: TransactionEconomicCostStatus
  usdAmount: null | Prisma.Decimal
}>) => ({
  conversionProvider: 'transfero',
  conversionStatus: EconomicConversionStatus.SETTLED,
  costs,
  customerPayoutNative: decimal(499),
  lockedRateNativePerUsd: decimal(5),
  payoutCurrency: TargetCurrency.BRL,
  proceedsCoverage: EconomicFactCoverageStatus.COMPLETE,
  providerProceedsNative: decimal(510),
})

const transaction = (overrides: Record<string, unknown> = {}) => ({
  economics: null,
  id: crypto.randomUUID(),
  partnerUserId: crypto.randomUUID(),
  quote: {
    cryptoCurrency: CryptoCurrency.USDC,
    sourceAmount: 100,
    targetAmount: 500,
    targetCurrency: TargetCurrency.BRL,
  },
  refundOnChainId: null,
  status: TransactionStatus.PAYMENT_COMPLETED,
  ...overrides,
})

describe('OpsBusinessPerformanceService', () => {
  it('keeps currencies separate and calculates transaction-level realized earnings and refunds', async () => {
    const costs = [
      { kind: TransactionEconomicCostKind.BRIDGE_FEE, status: TransactionEconomicCostStatus.CONFIRMED, usdAmount: decimal(1) },
      { kind: TransactionEconomicCostKind.BLOCKCHAIN_FEE, status: TransactionEconomicCostStatus.CONFIRMED, usdAmount: decimal('0.1') },
      { kind: TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE, status: TransactionEconomicCostStatus.CONFIRMED, usdAmount: decimal('0.2') },
    ]
    const voidCosts = [
      TransactionEconomicCostKind.BLOCKCHAIN_FEE,
      TransactionEconomicCostKind.BRIDGE_FEE,
      TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE,
    ].map(kind => ({
      kind,
      status: TransactionEconomicCostStatus.VOID,
      usdAmount: null,
    }))
    const current = [
      transaction({ economics: settledEconomics(costs) }),
      transaction({
        economics: {
          conversionProvider: 'transfero',
          conversionStatus: EconomicConversionStatus.PENDING,
          costs: voidCosts,
          customerPayoutNative: decimal(210_000),
          lockedRateNativePerUsd: null,
          payoutCurrency: TargetCurrency.COP,
          proceedsCoverage: EconomicFactCoverageStatus.PENDING,
          providerProceedsNative: null,
        },
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          sourceAmount: 50,
          targetAmount: 210_000,
          targetCurrency: TargetCurrency.COP,
        },
      }),
      transaction({
        economics: {
          conversionProvider: null,
          conversionStatus: EconomicConversionStatus.NOT_APPLICABLE,
          costs: [
            ...voidCosts,
            {
              kind: TransactionEconomicCostKind.REFUND_FEE,
              status: TransactionEconomicCostStatus.CONFIRMED,
              usdAmount: decimal('0.1'),
            },
          ],
          customerPayoutNative: decimal(500),
          lockedRateNativePerUsd: null,
          payoutCurrency: TargetCurrency.BRL,
          providerProceedsNative: null,
        },
        quote: {
          cryptoCurrency: CryptoCurrency.USDT,
          sourceAmount: 25,
          targetAmount: 125,
          targetCurrency: TargetCurrency.BRL,
        },
        refundOnChainId: 'refund-hash',
        status: TransactionStatus.PAYMENT_FAILED,
      }),
    ]
    const client = {
      businessPerformanceState: {
        findUnique: jest.fn().mockResolvedValue({
          backfillCompletedAt: new Date('2026-08-02T01:00:00.000Z'),
          lastReconciledAt: new Date(),
          quoteMetricsFrom: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      quote: { count: jest.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(0) },
      quoteRequestMetric: {
        groupBy: jest.fn()
          .mockResolvedValueOnce([
            { _count: { _all: 2 }, outcome: QuoteRequestOutcome.FAILED },
            { _count: { _all: 5 }, outcome: QuoteRequestOutcome.SUCCESS },
          ])
          .mockResolvedValueOnce([]),
      },
      transaction: { findMany: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce([]) },
    }
    const service = new OpsBusinessPerformanceService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as IDatabaseClientProvider)

    const report = await service.getReport({
      comparison: { from: new Date('2026-07-31T00:00:00.000Z'), to: new Date('2026-08-01T00:00:00.000Z') },
      primary: { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-02T00:00:00.000Z') },
    })

    expect(report.current).toMatchObject({
      acceptedTransactions: 3,
      acceptedUsdVolume: 175,
      completedTransactions: 2,
      completedUsdVolume: 150,
      excludedCompletedPayouts: { count: 1, valueUsd: 50 },
      failedQuotes: 2,
      grossTransactionMarginUsd: 2.2,
      netTransactionEarningsUsd: 0.8,
      quoteRequests: 7,
      quoteSuccessRate: 71.43,
      settledUltraConversionCount: 1,
    })
    expect(report.current.nativeCompletedPayouts).toEqual([
      { amount: 499, currency: 'BRL' },
      { amount: 210000, currency: 'COP' },
    ])
    expect(report.metrics.find(metric => metric.id === 'provider-payout-costs')).toMatchObject({
      currentValue: 0.2,
      unit: 'USD',
    })
    expect(client.transaction.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        createdAt: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lt: new Date('2026-08-02T00:00:00.000Z'),
        },
      },
    }))
    expect(report.metrics.find(metric => metric.id === 'quote-success-rate')).toMatchObject({
      changeKind: 'PERCENTAGE_POINT',
      comparisonValue: null,
    })
  })

  it('returns null rates for zero denominators and never fabricates net earnings with missing costs', async () => {
    const incomplete = transaction({
      economics: settledEconomics([]),
    })
    const client = {
      businessPerformanceState: {
        findUnique: jest.fn().mockResolvedValue({
          backfillCompletedAt: new Date('2026-08-02T01:00:00.000Z'),
          lastReconciledAt: null,
          quoteMetricsFrom: new Date('2026-08-01T12:00:00.000Z'),
        }),
      },
      quote: { count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0) },
      quoteRequestMetric: { groupBy: jest.fn().mockResolvedValue([]) },
      transaction: { findMany: jest.fn().mockResolvedValueOnce([incomplete]).mockResolvedValueOnce([]) },
    }
    const service = new OpsBusinessPerformanceService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as IDatabaseClientProvider)

    const report = await service.getReport({
      comparison: { from: new Date('2026-07-01T00:00:00.000Z'), to: new Date('2026-07-02T00:00:00.000Z') },
      primary: { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-02T00:00:00.000Z') },
    })

    expect(report.comparison.quoteSuccessRate).toBeNull()
    expect(report.comparison.terminalCompletionRate).toBeNull()
    expect(report.current.netTransactionEarningsUsd).toBeNull()
    expect(report.coverage.earnings.status).toBe('PARTIAL')
    expect(report.coverage.quotes.complete).toBe(false)
  })

  it('splits successful quote counting at the durable request-metric boundary', async () => {
    const boundary = new Date('2026-08-01T12:00:00.000Z')
    const client = {
      businessPerformanceState: {
        findUnique: jest.fn().mockResolvedValue({
          backfillCompletedAt: new Date(),
          lastReconciledAt: new Date(),
          quoteMetricsFrom: boundary,
        }),
      },
      quote: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(4) },
      quoteRequestMetric: {
        groupBy: jest.fn().mockResolvedValue([
          { _count: { _all: 1 }, outcome: QuoteRequestOutcome.FAILED },
          { _count: { _all: 2 }, outcome: QuoteRequestOutcome.SUCCESS },
        ]),
      },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new OpsBusinessPerformanceService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as IDatabaseClientProvider)

    const report = await service.getReport({
      comparison: { from: new Date('2026-07-31T00:00:00.000Z'), to: new Date('2026-08-01T00:00:00.000Z') },
      primary: { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-02T00:00:00.000Z') },
    })

    expect(report.current).toMatchObject({
      failedQuotes: 1,
      quoteRequests: 6,
      successfulQuotes: 5,
    })
    expect(report.comparison).toMatchObject({
      failedQuotes: 0,
      quoteRequests: 4,
      successfulQuotes: 4,
    })
    expect(client.quote.count).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { gte: new Date('2026-08-01T00:00:00.000Z'), lt: boundary } },
    })
    expect(client.quoteRequestMetric.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { requestedAt: { gte: boundary, lt: new Date('2026-08-02T00:00:00.000Z') } },
    }))
  })

  it('treats explicitly void costs as covered zero-value costs', async () => {
    const voidCosts = [
      TransactionEconomicCostKind.BLOCKCHAIN_FEE,
      TransactionEconomicCostKind.BRIDGE_FEE,
      TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE,
    ].map(kind => ({
      kind,
      status: TransactionEconomicCostStatus.VOID,
      usdAmount: null,
    }))
    const client = {
      businessPerformanceState: {
        findUnique: jest.fn().mockResolvedValue({
          backfillCompletedAt: new Date('2026-08-02T01:00:00.000Z'),
          lastReconciledAt: new Date(),
          quoteMetricsFrom: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      quote: { count: jest.fn() },
      quoteRequestMetric: { groupBy: jest.fn().mockResolvedValue([]) },
      transaction: {
        findMany: jest.fn()
          .mockResolvedValueOnce([transaction({ economics: settledEconomics(voidCosts) })])
          .mockResolvedValueOnce([]),
      },
    }
    const service = new OpsBusinessPerformanceService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as IDatabaseClientProvider)

    const report = await service.getReport({
      comparison: { from: new Date('2026-07-31T00:00:00.000Z'), to: new Date('2026-08-01T00:00:00.000Z') },
      primary: { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-02T00:00:00.000Z') },
    })

    expect(report.current.costCoverageComplete).toBe(true)
    expect(report.current.netTransactionEarningsUsd).toBe(2.2)
    expect(report.coverage.earnings.status).toBe('COMPLETE')
  })

  it('does not claim quote-failure coverage before the recorder has started', async () => {
    const client = {
      businessPerformanceState: {
        findUnique: jest.fn().mockResolvedValue({
          backfillCompletedAt: null,
          lastReconciledAt: null,
          quoteMetricsFrom: null,
        }),
      },
      quote: { count: jest.fn().mockResolvedValue(0) },
      quoteRequestMetric: { groupBy: jest.fn().mockResolvedValue([]) },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new OpsBusinessPerformanceService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as IDatabaseClientProvider)

    const report = await service.getReport({
      comparison: { from: new Date('2026-07-31T00:00:00.000Z'), to: new Date('2026-08-01T00:00:00.000Z') },
      primary: { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-02T00:00:00.000Z') },
    })

    expect(report.coverage.quotes).toMatchObject({
      complete: false,
      from: null,
      warnings: ['Quote-attempt coverage has not started.'],
    })
    expect(client.quoteRequestMetric.groupBy).not.toHaveBeenCalled()
  })

  it('separates unsettled-payout exclusions from settled conversions with missing facts', async () => {
    const settledWithoutFacts = transaction({
      economics: {
        conversionProvider: 'transfero',
        conversionStatus: EconomicConversionStatus.SETTLED,
        costs: [],
        customerPayoutNative: decimal(500),
        lockedRateNativePerUsd: null,
        payoutCurrency: TargetCurrency.BRL,
        proceedsCoverage: EconomicFactCoverageStatus.PENDING,
        providerProceedsNative: null,
      },
    })
    const settledFailedPayout = transaction({
      economics: settledEconomics([]),
      status: TransactionStatus.PAYMENT_FAILED,
    })
    const completedWithoutConversion = transaction({
      economics: {
        conversionProvider: null,
        conversionStatus: EconomicConversionStatus.NOT_APPLICABLE,
        costs: [],
        customerPayoutNative: decimal(500),
        lockedRateNativePerUsd: null,
        payoutCurrency: TargetCurrency.BRL,
        proceedsCoverage: EconomicFactCoverageStatus.UNAVAILABLE,
        providerProceedsNative: null,
      },
    })
    const client = {
      businessPerformanceState: {
        findUnique: jest.fn().mockResolvedValue({
          backfillCompletedAt: new Date(),
          lastReconciledAt: new Date(),
          quoteMetricsFrom: new Date('2026-07-01T00:00:00.000Z'),
        }),
      },
      quote: { count: jest.fn() },
      quoteRequestMetric: { groupBy: jest.fn().mockResolvedValue([]) },
      transaction: {
        findMany: jest.fn()
          .mockResolvedValueOnce([
            completedWithoutConversion,
            settledWithoutFacts,
            settledFailedPayout,
          ])
          .mockResolvedValueOnce([]),
      },
    }
    const service = new OpsBusinessPerformanceService({
      getClient: jest.fn().mockResolvedValue(client),
    } as unknown as IDatabaseClientProvider)

    const report = await service.getReport({
      comparison: { from: new Date('2026-07-31T00:00:00.000Z'), to: new Date('2026-08-01T00:00:00.000Z') },
      primary: { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-02T00:00:00.000Z') },
    })

    expect(report.current.excludedCompletedPayouts).toEqual({ count: 0, valueUsd: 0 })
    expect(report.current.settledUltraConversionCount).toBe(2)
    expect(report.coverage.earnings.missingEconomicFactCount).toBe(2)
    expect(report.current.netTransactionEarningsUsd).toBeNull()
  })
})
