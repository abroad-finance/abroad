export type OpsPartnerActivityFilter = 'ACTIVE' | 'INACTIVE'
export type OpsPartnerAnalyticsRange = '7d' | '24h' | '30d' | '90d'
export type OpsPartnerCurrencyAmount = {
  amount: number
  currency: string
}

export type OpsPartnerDirectoryItem = {
  completedTransactions: number
  country: null | string
  createdAt: string
  failedTransactions: number
  id: string
  lifecycle: OpsPartnerLifecycleFilter
  name: string
  payoutVolume: OpsPartnerCurrencyAmount[]
  sourceVolume: OpsPartnerCurrencyAmount[]
  stablecoinAmount: number
  successRatePct: null | number
  totalTransactions: number
}

export type OpsPartnerDirectoryResponse = {
  filterOptions: { countries: string[] }
  from: string
  items: OpsPartnerDirectoryItem[]
  maximumStablecoinAmount: number
  page: number
  pageSize: number
  range: OpsPartnerAnalyticsRange
  to: string
  total: number
}

export type OpsPartnerLifecycleFilter = 'LIVE' | 'NO_CREDENTIALS' | 'ONBOARDING'

export type OpsPartnerScorecard = {
  activity: {
    completedTransactions: number
    failedTransactions: number
    payoutVolume: OpsPartnerCurrencyAmount[]
    sourceVolume: OpsPartnerCurrencyAmount[]
    stablecoinAmount: number
    statusCounts: Array<{ count: number, status: string }>
    successRatePct: null | number
    totalTransactions: number
  }
  cases: Array<{ count: number, status: string }>
  corridors: Array<{
    blockchain: string
    completedTransactions: number
    cryptoCurrency: string
    sharePct: number
    stablecoinAmount: number
    targetCurrency: string
  }>
  from: string
  incidents: Array<{
    href: string
    id: string
    severity: string
    status: string
    title: string
  }>
  partner: {
    country: null | string
    createdAt: string
    id: string
    lifecycle: OpsPartnerLifecycleFilter
    name: string
  }
  range: OpsPartnerAnalyticsRange
  to: string
  transactionPath: string
  trend: Array<{
    at: string
    completed: number
    failed: number
    open: number
    total: number
  }>
  trendUnit: 'DAY' | 'HOUR'
  webhook: {
    delivered: number
    failed: number
    lastDeliveredAt: null | string
    pending: number
    successRatePct: null | number
    total: number
  }
}
