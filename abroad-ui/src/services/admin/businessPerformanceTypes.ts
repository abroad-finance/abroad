export type BusinessPerformanceChangeKind = 'PERCENT' | 'PERCENTAGE_POINT'
export type BusinessPerformanceCoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE'
export type BusinessPerformanceMetric = {
  change: null | number
  changeKind: BusinessPerformanceChangeKind
  comparisonValue: null | number
  currency?: string
  currentValue: null | number
  id: string
  label: string
  unit: BusinessPerformanceUnit
}

export type BusinessPerformancePeriod = {
  acceptedTransactions: number
  acceptedUsdVolume: number
  activeUsers: number
  allocatedBridgeCostsUsd: number
  blockchainAndRefundGasUsd: number
  completedTransactions: number
  completedUsdVolume: number
  costCoverageComplete: boolean
  excludedCompletedPayouts: { count: number, valueUsd: number }
  failedQuotes: number
  failedTransactions: number
  grossTransactionMarginUsd: number
  inFlightTransactions: number
  nativeCompletedPayouts: Array<{ amount: number, currency: string }>
  netTransactionEarningsUsd: null | number
  providerPayoutCostsUsd: number
  quoteRequests: number
  quoteSuccessRate: null | number
  settledUltraConversionCount: number
  successfulQuotes: number
  terminalCompletionRate: null | number
  transactionConversionRate: null | number
  ultraCustomerPayouts: Array<{ amount: number, currency: string }>
  ultraProceeds: Array<{ amount: number, currency: string }>
}

export type BusinessPerformanceRange = {
  from: string
  to: string
}

export type BusinessPerformanceRequest = {
  comparison?: BusinessPerformanceRange
  primary: BusinessPerformanceRange
}

export type BusinessPerformanceResponse = {
  comparison: BusinessPerformancePeriod
  coverage: {
    earnings: {
      historicalBackfillCompletedAt: null | string
      missingCostCount: number
      missingEconomicFactCount: number
      status: BusinessPerformanceCoverageStatus
      warnings: string[]
    }
    economicFactsReconciledAt: null | string
    quotes: {
      complete: boolean
      from: null | string
      pendingRequestCount: number
      warnings: string[]
    }
  }
  current: BusinessPerformancePeriod
  generatedAt: string
  metrics: BusinessPerformanceMetric[]
  ranges: {
    comparison: BusinessPerformanceRange
    primary: BusinessPerformanceRange
  }
}

export type BusinessPerformanceUnit = 'COUNT' | 'NATIVE' | 'RATE' | 'USD'
