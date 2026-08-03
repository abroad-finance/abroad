import { TargetCurrency } from '@prisma/client'

import { OpsBusinessPerformanceMetric, OpsBusinessPerformancePeriod, OpsBusinessPerformanceUnit } from './OpsBusinessPerformanceTypes'

const calculatePercentChange = (current: null | number, comparison: null | number): null | number => {
  if (current === null || comparison === null || comparison === 0) return null
  return Number((((current - comparison) / Math.abs(comparison)) * 100).toFixed(2))
}

const calculatePercentagePointChange = (
  current: null | number,
  comparison: null | number,
): null | number => (
  current === null || comparison === null
    ? null
    : Number((current - comparison).toFixed(2))
)

const currencyAmount = (
  amounts: Array<{ amount: number, currency: TargetCurrency }>,
  currency: TargetCurrency,
): number => amounts.find(item => item.currency === currency)?.amount ?? 0

const metric = (
  id: string,
  label: string,
  unit: Exclude<OpsBusinessPerformanceUnit, 'RATE'>,
  currentValue: null | number,
  comparisonValue: null | number,
  currency?: string,
): OpsBusinessPerformanceMetric => ({
  change: calculatePercentChange(currentValue, comparisonValue),
  changeKind: 'PERCENT',
  comparisonValue,
  ...(currency ? { currency } : {}),
  currentValue,
  id,
  label,
  unit,
})

const rateMetric = (
  id: string,
  label: string,
  currentValue: null | number,
  comparisonValue: null | number,
): OpsBusinessPerformanceMetric => ({
  change: calculatePercentagePointChange(currentValue, comparisonValue),
  changeKind: 'PERCENTAGE_POINT',
  comparisonValue,
  currentValue,
  id,
  label,
  unit: 'RATE',
})

export const buildOpsBusinessPerformanceMetrics = (
  current: OpsBusinessPerformancePeriod,
  comparison: OpsBusinessPerformancePeriod,
): OpsBusinessPerformanceMetric[] => {
  const metrics: OpsBusinessPerformanceMetric[] = [
    metric('quote-requests', 'Quote requests', 'COUNT', current.quoteRequests, comparison.quoteRequests),
    metric('successful-quotes', 'Successful quotes', 'COUNT', current.successfulQuotes, comparison.successfulQuotes),
    metric('failed-quotes', 'Failed quotes', 'COUNT', current.failedQuotes, comparison.failedQuotes),
    rateMetric('quote-success-rate', 'Quote success rate', current.quoteSuccessRate, comparison.quoteSuccessRate),
    metric('accepted-transactions', 'Accepted transactions', 'COUNT', current.acceptedTransactions, comparison.acceptedTransactions),
    metric('completed-transactions', 'Completed transactions', 'COUNT', current.completedTransactions, comparison.completedTransactions),
    metric('failed-transactions', 'Failed transactions', 'COUNT', current.failedTransactions, comparison.failedTransactions),
    metric('in-flight-transactions', 'In-flight transactions', 'COUNT', current.inFlightTransactions, comparison.inFlightTransactions),
    metric('active-users', 'Active users', 'COUNT', current.activeUsers, comparison.activeUsers),
    metric('accepted-usd-volume', 'Accepted USD volume', 'USD', current.acceptedUsdVolume, comparison.acceptedUsdVolume, 'USD'),
    metric('completed-usd-volume', 'Completed USD volume', 'USD', current.completedUsdVolume, comparison.completedUsdVolume, 'USD'),
    rateMetric('accepted-to-completed', 'Accepted-to-completed conversion', current.transactionConversionRate, comparison.transactionConversionRate),
    rateMetric('terminal-completion-rate', 'Terminal completion rate', current.terminalCompletionRate, comparison.terminalCompletionRate),
    metric('settled-ultra-conversions', 'Settled Ultra conversion count', 'COUNT', current.settledUltraConversionCount, comparison.settledUltraConversionCount),
    metric('gross-transaction-margin', 'Gross transaction margin', 'USD', current.grossTransactionMarginUsd, comparison.grossTransactionMarginUsd, 'USD'),
    metric('provider-payout-costs', 'Provider payout costs', 'USD', current.providerPayoutCostsUsd, comparison.providerPayoutCostsUsd, 'USD'),
    metric('allocated-bridge-costs', 'Allocated bridge costs', 'USD', current.allocatedBridgeCostsUsd, comparison.allocatedBridgeCostsUsd, 'USD'),
    metric('blockchain-refund-gas', 'Blockchain and refund gas', 'USD', current.blockchainAndRefundGasUsd, comparison.blockchainAndRefundGasUsd, 'USD'),
    metric('net-transaction-earnings', 'Net transaction earnings', 'USD', current.netTransactionEarningsUsd, comparison.netTransactionEarningsUsd, 'USD'),
    metric('excluded-completed-payouts', 'Completed payouts with unsettled conversions', 'COUNT', current.excludedCompletedPayouts.count, comparison.excludedCompletedPayouts.count),
    metric('excluded-completed-payout-value', 'Unsettled completed payout value', 'USD', current.excludedCompletedPayouts.valueUsd, comparison.excludedCompletedPayouts.valueUsd, 'USD'),
  ]

  const nativeCurrencies = new Set([
    ...comparison.nativeCompletedPayouts.map(item => item.currency),
    ...current.nativeCompletedPayouts.map(item => item.currency),
  ])
  for (const currency of [...nativeCurrencies].sort()) {
    metrics.push(metric(
      `completed-payout-${currency.toLowerCase()}`,
      `Completed payout total (${currency})`,
      'NATIVE',
      currencyAmount(current.nativeCompletedPayouts, currency),
      currencyAmount(comparison.nativeCompletedPayouts, currency),
      currency,
    ))
  }

  const ultraCurrencies = new Set([
    ...comparison.ultraProceeds.map(item => item.currency),
    ...current.ultraProceeds.map(item => item.currency),
  ])
  for (const currency of [...ultraCurrencies].sort()) {
    metrics.push(
      metric(
        `ultra-proceeds-${currency.toLowerCase()}`,
        `Ultra proceeds (${currency})`,
        'NATIVE',
        currencyAmount(current.ultraProceeds, currency),
        currencyAmount(comparison.ultraProceeds, currency),
        currency,
      ),
      metric(
        `ultra-customer-payouts-${currency.toLowerCase()}`,
        `Corresponding customer payouts (${currency})`,
        'NATIVE',
        currencyAmount(current.ultraCustomerPayouts, currency),
        currencyAmount(comparison.ultraCustomerPayouts, currency),
        currency,
      ),
    )
  }
  return metrics
}
