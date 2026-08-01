import type { FlowInstanceStatus } from './flowTypes'
import type { TransactionStatus } from './transactionAdminTypes'

export type OpsOverviewActivity = {
  current: OpsOverviewActivitySummary
  previous: OpsOverviewActivitySummary
  series: OpsOverviewActivityPoint[]
  seriesUnit: OpsOverviewSeriesUnit
}

export type OpsOverviewActivityPoint = {
  at: string
  completedTransactions: number
  expiredTransactions: number
  failedTransactions: number
  openTransactions: number
  totalTransactions: number
}

export type OpsOverviewActivitySummary = {
  completedTransactions: number
  payoutVolume: OpsOverviewPayoutVolume[]
  sourceVolume: OpsOverviewSourceVolume[]
  statusCounts: OpsOverviewTransactionStatusCount[]
  successRatePct: null | number
  totalTransactions: number
}

export type OpsOverviewBridge = {
  failedLegs: OpsOverviewBridgeLegSummary
  float: OpsOverviewBridgeFloat
  oldestPendingAt: null | string
  outstandingLegs: OpsOverviewBridgeLegSummary
}

export type OpsOverviewBridgeFloat = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
}

export type OpsOverviewBridgeLegSummary = {
  amount: number
  count: number
}

export type OpsOverviewExecution = {
  oldestWaitingAt: null | string
  statusCounts: OpsOverviewFlowStatusCount[]
  totalFlows: number
}

export type OpsOverviewFlowStatusCount = {
  count: number
  status: FlowInstanceStatus
}

export type OpsOverviewPartner = {
  completedTransactions: number
  id: string
  name: string
  sourceVolume: OpsOverviewSourceVolume[]
  stablecoinAmount: number
  totalTransactions: number
}

export type OpsOverviewPartners = {
  activePartners: number
  top: OpsOverviewPartner[]
  totalPartners: number
}

export type OpsOverviewPayoutCurrency = 'BRL' | 'COP'

export type OpsOverviewPayoutVolume = {
  amount: number
  currency: OpsOverviewPayoutCurrency
}

export type OpsOverviewRange = '7d' | '24h' | '30d'

export type OpsOverviewResponse = {
  activity: OpsOverviewActivity
  bridge: OpsOverviewBridge
  execution: OpsOverviewExecution
  generatedAt: string
  partners: OpsOverviewPartners
  treasury: OpsOverviewTreasury
  window: OpsOverviewWindow
}

export type OpsOverviewSeriesUnit = 'DAY' | 'HOUR'

export type OpsOverviewSourceCurrency = 'USDC' | 'USDT'

export type OpsOverviewSourceVolume = {
  amount: number
  currency: OpsOverviewSourceCurrency
}

export type OpsOverviewTransactionStatusCount = {
  count: number
  status: TransactionStatus
}

export type OpsOverviewTreasury = {
  capturedAt: string
  totalUsd: number
  totalUsdIsPartial: boolean
  venues: OpsOverviewTreasuryVenueHealth
}

export type OpsOverviewTreasuryVenueHealth = {
  reporting: number
  total: number
  unavailable: number
}

export type OpsOverviewWindow = {
  from: string
  previousFrom: string
  previousTo: string
  range: OpsOverviewRange
  to: string
}
