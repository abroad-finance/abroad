import { TargetCurrency } from '@prisma/client'

export type OpsBusinessPerformanceCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'

export type OpsBusinessPerformanceMetric = {
  change: null | number
  changeKind: OpsBusinessPerformanceChangeKind
  comparisonValue: null | number
  currency?: string
  currentValue: null | number
  id: string
  label: string
  unit: OpsBusinessPerformanceUnit
}

export type OpsBusinessPerformancePeriod = {
  acceptedTransactions: number
  acceptedUsdVolume: number
  activeUsers: number
  allocatedBridgeCostsUsd: number
  blockchainAndRefundGasUsd: number
  completedTransactions: number
  completedUsdVolume: number
  costCoverageComplete: boolean
  excludedCompletedPayouts: {
    count: number
    valueUsd: number
  }
  failedQuotes: number
  failedTransactions: number
  grossTransactionMarginUsd: number
  inFlightTransactions: number
  nativeCompletedPayouts: Array<{ amount: number, currency: TargetCurrency }>
  netTransactionEarningsUsd: null | number
  providerPayoutCostsUsd: number
  quoteRequests: number
  quoteSuccessRate: null | number
  settledUltraConversionCount: number
  successfulQuotes: number
  terminalCompletionRate: null | number
  transactionConversionRate: null | number
  ultraCustomerPayouts: Array<{ amount: number, currency: TargetCurrency }>
  ultraProceeds: Array<{ amount: number, currency: TargetCurrency }>
}

export type OpsBusinessPerformancePeriodFacts = {
  missingCostCount: number
  missingEconomicFactCount: number
  pendingQuoteRequestCount: number
  realizedTransactionCount: number
  summary: OpsBusinessPerformancePeriod
  warnings: string[]
}

export type OpsBusinessPerformanceRange = {
  from: Date
  to: Date
}

export type OpsBusinessPerformanceResponse = {
  comparison: OpsBusinessPerformancePeriod
  coverage: {
    earnings: {
      historicalBackfillCompletedAt: Date | null
      missingCostCount: number
      missingEconomicFactCount: number
      status: OpsBusinessPerformanceCoverageStatus
      warnings: string[]
    }
    economicFactsReconciledAt: Date | null
    quotes: {
      complete: boolean
      from: Date | null
      pendingRequestCount: number
      warnings: string[]
    }
  }
  current: OpsBusinessPerformancePeriod
  generatedAt: Date
  metrics: OpsBusinessPerformanceMetric[]
  ranges: {
    comparison: OpsBusinessPerformanceRange
    primary: OpsBusinessPerformanceRange
  }
}

export type OpsBusinessPerformanceUnit = 'COUNT' | 'NATIVE' | 'RATE' | 'USD'

type OpsBusinessPerformanceChangeKind = 'PERCENT' | 'PERCENTAGE_POINT'
