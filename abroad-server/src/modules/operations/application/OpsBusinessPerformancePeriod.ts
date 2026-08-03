import {
  EconomicConversionStatus,
  EconomicFactCoverageStatus,
  Prisma,
  QuoteRequestOutcome,
  TargetCurrency,
  TransactionEconomicCostKind,
  TransactionEconomicCostStatus,
  TransactionStatus,
} from '@prisma/client'

import { OpsBusinessPerformancePeriodFacts } from './OpsBusinessPerformanceTypes'

export const performanceTransactionSelect = {
  economics: {
    select: {
      conversionProvider: true,
      conversionStatus: true,
      costs: {
        select: {
          kind: true,
          status: true,
          usdAmount: true,
        },
      },
      customerPayoutNative: true,
      lockedRateNativePerUsd: true,
      payoutCurrency: true,
      proceedsCoverage: true,
      providerProceedsNative: true,
    },
  },
  id: true,
  partnerUserId: true,
  quote: {
    select: {
      cryptoCurrency: true,
      sourceAmount: true,
      targetAmount: true,
      targetCurrency: true,
    },
  },
  refundOnChainId: true,
  status: true,
} satisfies Prisma.TransactionSelect

type DecimalTotals = {
  allocatedBridgeCostsUsd: Prisma.Decimal
  blockchainAndRefundGasUsd: Prisma.Decimal
  completedUsdVolume: Prisma.Decimal
  grossTransactionMarginUsd: Prisma.Decimal
  nativeCompletedPayouts: Map<TargetCurrency, Prisma.Decimal>
  providerPayoutCostsUsd: Prisma.Decimal
  sourceUsdVolume: Prisma.Decimal
  ultraCustomerPayouts: Map<TargetCurrency, Prisma.Decimal>
  ultraProceeds: Map<TargetCurrency, Prisma.Decimal>
}

type PerformanceTransaction = Prisma.TransactionGetPayload<{
  select: typeof performanceTransactionSelect
}>

const TERMINAL_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])
const ZERO = new Prisma.Decimal(0)

const addDecimal = <TKey extends string>(
  totals: Map<TKey, Prisma.Decimal>,
  key: TKey,
  value: Prisma.Decimal,
): void => {
  totals.set(key, (totals.get(key) ?? ZERO).plus(value))
}

const asDecimal = (value: number): Prisma.Decimal => new Prisma.Decimal(String(value))

const asOutputNumber = (value: Prisma.Decimal): number => Number(value.toFixed(6))

const calculatePercent = (numerator: number, denominator: number): null | number => (
  denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(2))
)

const countMissingCost = (
  costs: NonNullable<PerformanceTransaction['economics']>['costs'],
  kind: TransactionEconomicCostKind,
): number => costs.some(cost => (
  cost.kind === kind
  && (
    (
      cost.status === TransactionEconomicCostStatus.CONFIRMED
      && cost.usdAmount !== null
    )
    || cost.status === TransactionEconomicCostStatus.VOID
  )
))
  ? 0
  : 1

const emptyDecimalTotals = (): DecimalTotals => ({
  allocatedBridgeCostsUsd: ZERO,
  blockchainAndRefundGasUsd: ZERO,
  completedUsdVolume: ZERO,
  grossTransactionMarginUsd: ZERO,
  nativeCompletedPayouts: new Map(),
  providerPayoutCostsUsd: ZERO,
  sourceUsdVolume: ZERO,
  ultraCustomerPayouts: new Map(),
  ultraProceeds: new Map(),
})

const mapCurrencyTotals = (
  totals: Map<TargetCurrency, Prisma.Decimal>,
): Array<{ amount: number, currency: TargetCurrency }> => (
  [...totals.entries()]
    .map(([currency, amount]) => ({ amount: asOutputNumber(amount), currency }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
)

const sumConfirmedCosts = (
  costs: NonNullable<PerformanceTransaction['economics']>['costs'],
  totals: DecimalTotals,
): void => {
  for (const cost of costs) {
    if (cost.status !== TransactionEconomicCostStatus.CONFIRMED || !cost.usdAmount) continue
    switch (cost.kind) {
      case TransactionEconomicCostKind.BLOCKCHAIN_FEE:
      case TransactionEconomicCostKind.REFUND_FEE:
        totals.blockchainAndRefundGasUsd = totals.blockchainAndRefundGasUsd.plus(cost.usdAmount)
        break
      case TransactionEconomicCostKind.BRIDGE_FEE:
        totals.allocatedBridgeCostsUsd = totals.allocatedBridgeCostsUsd.plus(cost.usdAmount)
        break
      case TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE:
        totals.providerPayoutCostsUsd = totals.providerPayoutCostsUsd.plus(cost.usdAmount)
        break
      default: {
        const exhaustive: never = cost.kind
        throw new Error(`Unsupported transaction economic cost kind: ${String(exhaustive)}`)
      }
    }
  }
}

export const summarizeBusinessPerformancePeriod = (params: {
  quoteMetricGroups: Array<{ _count: { _all: number }, outcome: QuoteRequestOutcome }>
  successfulQuotes: number
  transactions: PerformanceTransaction[]
}): OpsBusinessPerformancePeriodFacts => {
  const quoteCounts = new Map(params.quoteMetricGroups.map(group => [group.outcome, group._count._all]))
  const failedQuotes = quoteCounts.get(QuoteRequestOutcome.FAILED) ?? 0
  const pendingQuoteRequestCount = quoteCounts.get(QuoteRequestOutcome.PENDING) ?? 0
  const totals = emptyDecimalTotals()
  const activeUsers = new Set<string>()
  let completedTransactions = 0
  let failedTransactions = 0
  let inFlightTransactions = 0
  let terminalTransactions = 0
  let settledUltraConversionCount = 0
  let excludedCompletedPayoutCount = 0
  let excludedCompletedPayoutValueUsd = ZERO
  let missingCostCount = 0
  let missingEconomicFactCount = 0
  let realizedTransactionCount = 0
  const warnings = new Set<string>()

  for (const transaction of params.transactions) {
    activeUsers.add(transaction.partnerUserId)
    const sourceAmount = asDecimal(transaction.quote.sourceAmount)
    totals.sourceUsdVolume = totals.sourceUsdVolume.plus(sourceAmount)

    if (TERMINAL_STATUSES.has(transaction.status)) terminalTransactions += 1
    if (transaction.status === TransactionStatus.PAYMENT_COMPLETED) {
      completedTransactions += 1
      totals.completedUsdVolume = totals.completedUsdVolume.plus(sourceAmount)
      const customerPayout = transaction.economics?.customerPayoutNative
        ?? asDecimal(transaction.quote.targetAmount)
      addDecimal(totals.nativeCompletedPayouts, transaction.quote.targetCurrency, customerPayout)
    }
    else if (TERMINAL_STATUSES.has(transaction.status)) {
      failedTransactions += 1
    }
    else {
      inFlightTransactions += 1
    }

    const economics = transaction.economics
    const conversionStatus = economics?.conversionStatus
    const conversionSettled = conversionStatus === EconomicConversionStatus.SETTLED
    const conversionUnsettled = conversionStatus === undefined
      || conversionStatus === EconomicConversionStatus.PENDING
      || conversionStatus === EconomicConversionStatus.FAILED
    const settledUltra = economics?.conversionProvider === 'transfero' && conversionSettled
    if (settledUltra) settledUltraConversionCount += 1

    const lockedRate = economics?.lockedRateNativePerUsd
    const providerProceeds = economics?.providerProceedsNative
    const hasCompleteConversionEconomics = conversionSettled
      && economics?.proceedsCoverage === EconomicFactCoverageStatus.COMPLETE
      && lockedRate?.gt(0) === true
      && providerProceeds !== null
      && providerProceeds !== undefined
    const isRealizedTransaction = transaction.status === TransactionStatus.PAYMENT_COMPLETED
      && hasCompleteConversionEconomics

    if (!isRealizedTransaction) {
      if (transaction.status === TransactionStatus.PAYMENT_COMPLETED && conversionUnsettled) {
        excludedCompletedPayoutCount += 1
        excludedCompletedPayoutValueUsd = excludedCompletedPayoutValueUsd.plus(sourceAmount)
        warnings.add('Completed payouts with unsettled conversions are excluded from realized earnings.')
      }
      if (transaction.status === TransactionStatus.PAYMENT_COMPLETED && conversionSettled) {
        missingEconomicFactCount += 1
        warnings.add('Settled conversions are missing an actual locked rate or provider proceeds.')
      }
      if (
        transaction.status === TransactionStatus.PAYMENT_COMPLETED
        && conversionStatus === EconomicConversionStatus.NOT_APPLICABLE
      ) {
        missingEconomicFactCount += 1
        warnings.add('Completed payouts without reportable conversion economics are excluded from realized earnings.')
      }
      sumConfirmedCosts(economics?.costs ?? [], totals)
      if (TERMINAL_STATUSES.has(transaction.status)) {
        const requiredKinds = new Set<TransactionEconomicCostKind>([
          TransactionEconomicCostKind.BLOCKCHAIN_FEE,
          TransactionEconomicCostKind.BRIDGE_FEE,
          TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE,
        ])
        if (transaction.refundOnChainId) {
          requiredKinds.add(TransactionEconomicCostKind.REFUND_FEE)
        }
        for (const kind of requiredKinds) {
          missingCostCount += countMissingCost(economics?.costs ?? [], kind)
        }
      }
      continue
    }

    if (!economics || !lockedRate || !providerProceeds) {
      missingEconomicFactCount += 1
      warnings.add('Settled conversions are missing an actual locked rate or provider proceeds.')
      continue
    }
    realizedTransactionCount += 1
    const customerPayout = economics.customerPayoutNative
    if (economics.conversionProvider === 'transfero') {
      addDecimal(totals.ultraProceeds, economics.payoutCurrency, providerProceeds)
      addDecimal(totals.ultraCustomerPayouts, economics.payoutCurrency, customerPayout)
    }
    totals.grossTransactionMarginUsd = totals.grossTransactionMarginUsd.plus(
      providerProceeds.minus(customerPayout).dividedBy(lockedRate),
    )
    sumConfirmedCosts(economics.costs, totals)

    const requiredKinds = new Set<TransactionEconomicCostKind>([
      TransactionEconomicCostKind.BLOCKCHAIN_FEE,
      TransactionEconomicCostKind.BRIDGE_FEE,
      TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE,
    ])
    if (transaction.refundOnChainId) requiredKinds.add(TransactionEconomicCostKind.REFUND_FEE)
    for (const kind of requiredKinds) {
      missingCostCount += countMissingCost(economics.costs, kind)
    }
  }

  if (missingCostCount > 0) {
    warnings.add('Net earnings include only confirmed costs; unresolved provider, bridge, blockchain, or refund costs are excluded and may reduce the value when reconciled.')
  }

  const confirmedCosts = totals.allocatedBridgeCostsUsd
    .plus(totals.blockchainAndRefundGasUsd)
    .plus(totals.providerPayoutCostsUsd)
  const hasReportableEarnings = realizedTransactionCount > 0
    || (missingCostCount === 0 && missingEconomicFactCount === 0)
  const netTransactionEarningsUsd = hasReportableEarnings
    ? asOutputNumber(totals.grossTransactionMarginUsd.minus(confirmedCosts))
    : null
  const quoteTerminalCount = params.successfulQuotes + failedQuotes

  return {
    missingCostCount,
    missingEconomicFactCount,
    pendingQuoteRequestCount,
    realizedTransactionCount,
    summary: {
      acceptedTransactions: params.transactions.length,
      acceptedUsdVolume: asOutputNumber(totals.sourceUsdVolume),
      activeUsers: activeUsers.size,
      allocatedBridgeCostsUsd: asOutputNumber(totals.allocatedBridgeCostsUsd),
      blockchainAndRefundGasUsd: asOutputNumber(totals.blockchainAndRefundGasUsd),
      completedTransactions,
      completedUsdVolume: asOutputNumber(totals.completedUsdVolume),
      costCoverageComplete: missingCostCount === 0,
      excludedCompletedPayouts: {
        count: excludedCompletedPayoutCount,
        valueUsd: asOutputNumber(excludedCompletedPayoutValueUsd),
      },
      failedQuotes,
      failedTransactions,
      grossTransactionMarginUsd: asOutputNumber(totals.grossTransactionMarginUsd),
      inFlightTransactions,
      nativeCompletedPayouts: mapCurrencyTotals(totals.nativeCompletedPayouts),
      netTransactionEarningsUsd,
      providerPayoutCostsUsd: asOutputNumber(totals.providerPayoutCostsUsd),
      quoteRequests: quoteTerminalCount + pendingQuoteRequestCount,
      quoteSuccessRate: calculatePercent(params.successfulQuotes, quoteTerminalCount),
      settledUltraConversionCount,
      successfulQuotes: params.successfulQuotes,
      terminalCompletionRate: calculatePercent(completedTransactions, terminalTransactions),
      transactionConversionRate: calculatePercent(completedTransactions, params.transactions.length),
      ultraCustomerPayouts: mapCurrencyTotals(totals.ultraCustomerPayouts),
      ultraProceeds: mapCurrencyTotals(totals.ultraProceeds),
    },
    warnings: [...warnings],
  }
}
