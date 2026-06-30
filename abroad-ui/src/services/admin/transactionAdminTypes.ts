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

export type OpsTransactionDetail = OpsTransactionSummary & {
  accountNumber: string
  bankCode: string
  exchangeHandoffAt: null | string
  flowInstanceId: null | string
  qrCode: null | string
  refundOnChainId: null | string
  taxId: null | string
}

export type OpsTransactionListResponse = {
  items: OpsTransactionSummary[]
  page: number
  pageSize: number
  total: number
}

export type OpsTransactionQuote = {
  country: string
  cryptoCurrency: string
  network: string
  paymentMethod: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: string
}

export type OpsTransactionSearchFilters = {
  externalId?: string
  onChainId?: string
  page?: number
  pageSize?: number
  partnerId?: string
  status?: TransactionStatus
  userId?: string
}

export type OpsTransactionSummary = {
  createdAt: string
  externalId: null | string
  id: string
  onChainId: null | string
  partnerId: string
  quote: OpsTransactionQuote
  status: TransactionStatus
  userId: string
}

export type ReconciliationResult
  = 'alreadyProcessed'
    | 'enqueued'
    | 'failed'
    | 'invalid'
    | 'notFound'
    | 'unresolved'

export type TransactionStatus = typeof transactionStatuses[number]
