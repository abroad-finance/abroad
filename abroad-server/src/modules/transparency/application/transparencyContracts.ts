import type { CryptoCurrency, TransactionStatus } from '@prisma/client'

export type TransparencyCoverage = {
  corridors: number
  networks: string[]
  payoutCurrencies: string[]
  payoutMethods: string[]
  sourceAssets: string[]
}

export type TransparencyDailyOutcome = {
  accepted: number
  completed: number
  date: string
  failed: number
  inFlight: number
  otherTerminal: number
}

export type TransparencyMetricsResponse = {
  generatedAt: string
  openSource: TransparencyOpenSourceMetrics
  platform: TransparencyPlatformMetrics
  refreshAfterSeconds: number
  schemaVersion: '1.0'
}

export type TransparencyOpenSourceMetrics = {
  asOf: null | string
  cache: 'unavailable' | TransparencyCacheFreshness
  commitsLast90Days: null | number
  contributors: null | number
  defaultBranch: null | string
  forks: null | number
  openIssues: null | number
  openPullRequests: null | number
  pushedAt: null | string
  repository: string
  stars: null | number
}

export type TransparencyOpenSourceSnapshot = Omit<
  TransparencyOpenSourceMetrics,
  'cache'
>

export type TransparencyPlatformMetrics = {
  cache: TransparencyCacheFreshness
  coverage: TransparencyCoverage
  dailyOutcomes: TransparencyDailyOutcome[]
  generatedAt: string
  rolling30Days: TransparencyPeriodMetrics
  totals: {
    acceptedTransactions: number
    completedSourceVolume: TransparencyVolume[]
    completedTransactions: number
    completionRate: null | number
    partnerOrganizations: number
    statusBreakdown: TransparencyStatusCount[]
    userRecords: number
  }
}

export type TransparencyPlatformSnapshot = Omit<
  TransparencyPlatformMetrics,
  'cache'
>

export type TransparencyStatusCount = {
  count: number
  status: TransactionStatus
}

export type TransparencyVolume = {
  amount: number
  asset: CryptoCurrency
}

type TransparencyCacheFreshness = 'fresh' | 'stale'

type TransparencyPeriodMetrics = {
  acceptedTransactions: number
  activePartnerOrganizations: number
  activeUserRecords: number
  completedSourceVolume: TransparencyVolume[]
  completedTransactions: number
  completionRate: null | number
  statusBreakdown: TransparencyStatusCount[]
}
