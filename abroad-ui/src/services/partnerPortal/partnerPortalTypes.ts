export const partnerTransactionStatuses = [
  'AWAITING_PAYMENT',
  'PROCESSING_PAYMENT',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'PAYMENT_COMPLETED',
  'WRONG_AMOUNT',
] as const

export type PartnerPortalSession = {
  accessToken: string
  expiresAt: string
  partnerName: string
}

export type PartnerTransactionDelivery = {
  attempts: number
  event: 'transaction.created' | 'transaction.updated' | 'unknown'
  lastAttemptAt: string
  status: 'DELIVERED' | 'DELIVERING' | 'FAILED' | 'PENDING'
}

export type PartnerTransactionDetail = PartnerTransactionSummary & {
  deliveries: PartnerTransactionDelivery[]
  lifecycle: PartnerTransactionLifecycle[]
  payoutDestinationHint: null | string
  pixEndToEndId: null | string
  refund: null | PartnerTransactionRefund
}

export type PartnerTransactionFilters = {
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
  query?: string
  status?: PartnerTransactionStatus
}

export type PartnerTransactionLifecycle = {
  occurredAt: string
  status: PartnerTransactionStatus
  type: 'CREATED' | 'STATUS_CHANGED'
}

export type PartnerTransactionListResponse = {
  items: PartnerTransactionSummary[]
  page: number
  pageSize: number
  statusCounts: PartnerTransactionStatusCount[]
  total: number
}

export type PartnerTransactionQuote = {
  country: string
  cryptoCurrency: string
  network: string
  paymentMethod: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: string
}

export type PartnerTransactionRefund = {
  onChainId: null | string
  status: 'COMPLETED' | 'FAILED' | 'NOT_STARTED' | 'PROCESSING'
}

export type PartnerTransactionStatus = typeof partnerTransactionStatuses[number]

export type PartnerTransactionStatusCount = {
  count: number
  status: PartnerTransactionStatus
}

export type PartnerTransactionSummary = {
  createdAt: string
  id: string
  onChainId: null | string
  quote: PartnerTransactionQuote
  status: PartnerTransactionStatus
  userReference: string
}
