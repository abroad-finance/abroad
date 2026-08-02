export const reconciliationBlockchains = [
  'STELLAR',
  'SOLANA',
  'CELO',
] as const

export const transactionStatuses = [
  'AWAITING_PAYMENT',
  'PROCESSING_PAYMENT',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'PAYMENT_COMPLETED',
  'WRONG_AMOUNT',
] as const

export const opsAttentionFilters = [
  'ALL',
  'PAYMENT_FAILED',
  'PROOF_MISSING',
  'REFUND_PENDING',
  'WEBHOOK_FAILED',
  'FLOW_FAILED',
] as const

export const opsProofStatuses = [
  'AVAILABLE',
  'MISSING',
  'PENDING',
  'NOT_APPLICABLE',
] as const
export const opsRefundStatuses = [
  'COMPLETED',
  'FAILED',
  'PROCESSING',
  'NOT_STARTED',
  'NOT_APPLICABLE',
] as const
export const opsWebhookStatuses = [
  'DELIVERED',
  'DELIVERING',
  'FAILED',
  'PENDING',
] as const

export type OpsAttentionFilter = typeof opsAttentionFilters[number]
export type OpsCasePriority = 'CRITICAL' | 'HIGH' | 'LOW' | 'NORMAL'
export type OpsCaseStatus = 'ACKNOWLEDGED' | 'OPEN' | 'RESOLVED'
export type OpsCaseSummary = {
  id: string
  owner: null | OpsCaseUser
  priority: OpsCasePriority
  status: OpsCaseStatus
  team: null | string
  updatedAt: string
  version: number
}
export type OpsCaseUser = { displayName: string, id: string }
export type OpsEvidenceEvent = {
  category: 'CASE' | 'CHAIN' | 'FLOW' | 'PROOF' | 'PROVIDER' | 'QUOTE' | 'REFUND' | 'TRANSACTION' | 'WEBHOOK'
  description: string
  id: string
  occurredAt: string
  state: 'FAILED' | 'INFO' | 'PENDING' | 'SUCCEEDED' | 'WARNING'
  title: string
}
export type OpsFailureGuidance = {
  ambiguityWarning: null | string
  category: 'DESTINATION' | 'FLOW_EXECUTION' | 'LIQUIDITY' | 'NETWORK' | 'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'RATE_LIMIT' | 'REFUND' | 'UNKNOWN' | 'WEBHOOK'
  label: string
  recommendedAction: string
}
export type OpsProofStatus = typeof opsProofStatuses[number]
export type OpsReconcileTransactionHashInput = {
  blockchain: typeof reconciliationBlockchains[number]
  on_chain_tx: string
  transaction_id?: string
}
export type OpsReconcileTransactionHashResponse = {
  blockchain: typeof reconciliationBlockchains[number]
  on_chain_tx: string
  reason?: string
  result: ReconciliationResult
  transaction_id: null | string
  transaction_status: null | string
}
export type OpsRefundStatus = typeof opsRefundStatuses[number]
export type OpsTransactionCaseDetail = OpsCaseSummary & {
  handoffs: Array<{
    actor: OpsCaseUser
    createdAt: string
    fromTeam: null | string
    fromUser: null | OpsCaseUser
    id: string
    note: string
    toTeam: null | string
    toUser: null | OpsCaseUser
  }>
  notes: Array<{
    author: OpsCaseUser
    body: string
    createdAt: string
    id: string
    kind: 'ESCALATION' | 'NOTE' | 'RESOLUTION'
  }>
}
export type OpsTransactionDetail = OpsTransactionSummary & {
  case: null | OpsTransactionCaseDetail
  evidence: OpsEvidenceEvent[]
  failure: null | OpsFailureGuidance
  identifiers: {
    externalId: null | string
    flowInstanceId: null | string
    onChainId: null | string
    pixEndToEndId: null | string
    quoteId: string
    refundOnChainId: null | string
    transactionId: string
  }
  latestEvent: OpsEvidenceEvent
  payoutDestinationHint: null | string
  summary: string
  webhookDeliveries: Array<{
    attempts: number
    durationMs: null | number
    event: string
    httpStatus: null | number
    id: string
    occurredAt: string
    purpose: string
    status: typeof opsWebhookStatuses[number]
  }>
}
export type OpsTransactionEvidenceExport = {
  evidence: OpsEvidenceEvent[]
  exportedAt: string
  failure: null | OpsFailureGuidance
  identifiers: OpsTransactionDetail['identifiers']
  partner: OpsTransactionSummary['partner']
  quote: OpsTransactionQuote
  refund: OpsTransactionSummary['refund']
  status: TransactionStatus
  webhook: OpsTransactionSummary['webhook']
}
export type OpsTransactionFilteredEvidenceExport = {
  exportedAt: string
  filterDimensions: string[]
  items: OpsTransactionSummary[]
  total: number
  truncated: boolean
}
export type OpsTransactionListResponse = {
  items: OpsTransactionSummary[]
  page: number
  pageSize: number
  statusCounts: Array<{ count: number, status: TransactionStatus }>
  total: number
}
export type OpsTransactionQuote = {
  country: string
  cryptoCurrency: 'USDC' | 'USDT'
  network: 'CELO' | 'SOLANA' | 'STELLAR'
  paymentMethod: 'BREB' | 'MOVII' | 'NEQUI' | 'PIX'
  quoteId: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: 'BRL' | 'COP'
}
export type OpsTransactionSearchFilters = {
  attention?: OpsAttentionFilter
  caseOwnerId?: string
  caseStatus?: OpsCaseStatus
  createdFrom?: string
  createdTo?: string
  cryptoCurrency?: OpsTransactionQuote['cryptoCurrency']
  network?: OpsTransactionQuote['network']
  page?: number
  pageSize?: number
  partnerId?: string
  paymentMethod?: OpsTransactionQuote['paymentMethod']
  proofStatus?: OpsProofStatus
  query?: string
  refundStatus?: OpsRefundStatus
  status?: TransactionStatus
  targetCurrency?: OpsTransactionQuote['targetCurrency']
  webhookStatus?: typeof opsWebhookStatuses[number]
}
export type OpsTransactionSummary = {
  attentionReasons: Array<'FLOW_FAILED' | 'PAYMENT_FAILED' | 'PROOF_MISSING' | 'REFUND_PENDING' | 'WEBHOOK_FAILED'>
  case: null | OpsCaseSummary
  createdAt: string
  flow: null | {
    currentStepOrder: null | number
    id: string
    status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'NOT_STARTED' | 'WAITING'
    updatedAt: string
  }
  id: string
  partner: { id: string, name: string }
  proof: { receiptEligible: boolean, status: OpsProofStatus }
  provider: { code: OpsTransactionQuote['paymentMethod'], label: string }
  quote: OpsTransactionQuote
  refund: { onChainId: null | string, status: OpsRefundStatus }
  sla: {
    ageMinutes: number
    state: 'AT_RISK' | 'BREACHED' | 'COMPLETE' | 'WITHIN_TARGET'
    targetMinutes: null | number
  }
  status: TransactionStatus
  webhook: {
    attempts: number
    httpStatus: null | number
    lastAttemptAt: null | string
    status: 'FAILED' | 'NONE' | 'PENDING' | 'SUCCEEDED'
  }
}
export type ReconciliationResult
  = 'alreadyProcessed'
    | 'enqueued'
    | 'failed'
    | 'invalid'
    | 'notFound'
    | 'unresolved'
export type TransactionStatus = typeof transactionStatuses[number]
