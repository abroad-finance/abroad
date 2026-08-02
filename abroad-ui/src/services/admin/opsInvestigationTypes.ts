import type {
  OpsCasePriority,
  OpsCaseStatus,
  OpsCaseUser,
} from './transactionAdminTypes'

export const opsCasePriorities = [
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
] as const
export const opsCaseStatuses = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const

export type OpsCase = {
  createdAt: string
  handoffs: OpsCaseHandoff[]
  id: string
  notes: OpsCaseNote[]
  owner: null | OpsCaseUser
  priority: OpsCasePriority
  resolvedAt: null | string
  status: OpsCaseStatus
  team: null | string
  transaction: {
    createdAt: string
    id: string
    partner: { id: string, name: string }
    sourceAmount: number
    sourceCurrency: string
    status: string
    targetAmount: number
    targetCurrency: string
  }
  updatedAt: string
  version: number
}
export type OpsCaseCreateInput = {
  ownerUserId?: string
  priority?: OpsCasePriority
  team?: string
  transactionId: string
}
export type OpsCaseHandoff = {
  actor: OpsCaseUser
  createdAt: string
  fromTeam: null | string
  fromUser: null | OpsCaseUser
  id: string
  note: string
  toTeam: null | string
  toUser: null | OpsCaseUser
}
export type OpsCaseHandoffInput = {
  note: string
  toTeam?: null | string
  toUserId?: null | string
}
export type OpsCaseListResponse = {
  items: OpsCase[]
  page: number
  pageSize: number
  total: number
}
export type OpsCaseNote = {
  author: OpsCaseUser
  body: string
  createdAt: string
  id: string
  kind: 'ESCALATION' | 'NOTE' | 'RESOLUTION'
}
export type OpsCaseUpdateInput = {
  ownerUserId?: null | string
  priority?: OpsCasePriority
  status?: OpsCaseStatus
  team?: null | string
}
export type OpsGlobalSearchResponse = {
  items: OpsGlobalSearchResult[]
  query: string
  truncated: boolean
}
export type OpsGlobalSearchResult = {
  context: string
  kind: 'CASE' | 'FLOW' | 'PARTNER' | 'TRANSACTION'
  matchedFields: string[]
  route: string
  secondary: string
  title: string
}
export type OpsSavedView = {
  createdAt: string
  filters: OpsSavedViewFilters
  id: string
  name: string
  owner: OpsCaseUser
  resource: OpsSavedViewResource
  scope: 'PRIVATE' | 'TEAM'
  updatedAt: string
  version: number
}
export type OpsSavedViewFilters = {
  attention?: string
  blockchain?: string
  caseOwnerId?: string
  caseStatus?: string
  createdFrom?: string
  createdTo?: string
  cryptoCurrency?: string
  failure?: string
  failureCategory?: string
  kind?: string
  network?: string
  onChainId?: string
  ownerUserId?: string
  pageSize?: number
  partnerId?: string
  paymentMethod?: string
  payoutProvider?: string
  priority?: string
  proofStatus?: string
  provider?: string
  query?: string
  refundStatus?: string
  severity?: string
  status?: string
  stuckMinutes?: number
  targetCurrency?: string
  team?: string
  transactionId?: string
  unowned?: boolean
  venue?: string
  webhookStatus?: string
}
export type OpsSavedViewResource = 'AUDIT' | 'CONFIGURATION' | 'FLOWS' | 'INCIDENTS' | 'KYC' | 'PARTNERS' | 'TRANSACTIONS'
