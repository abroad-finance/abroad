import type { TargetCurrency } from '../../api'

export type BlockchainNetwork = 'CELO' | 'ETHEREUM' | 'SOLANA' | 'STELLAR'

export type Country = 'BR' | 'CO'
export type CryptoCurrency = 'ETH' | 'SOL' | 'USDC' | 'USDT'
export interface PaginatedTransactionList {
  page: number
  pageSize: number
  total: number
  transactions: TransactionData[]
}
export type PaymentMethod = 'BOTON' | 'BRE_B' | 'PIX'

export interface QuoteData {
  cryptoCurrency: CryptoCurrency
  id: string
  network: BlockchainNetwork
  paymentMethod: PaymentMethod
  sourceAmount: number
  targetAmount: number
  targetCurrency: TargetCurrency
}

export interface TransactionData {
  accountNumber: string
  createdAt: string
  exchangeHandoffAt: null | string
  externalId: null | string
  id: string
  onChainId: null | string
  partnerUserId: string
  qrCode: null | string
  quote: QuoteData
  quoteId: string
  refundOnChainId: null | string
  status: TransactionStatus
  taxId: null | string
}

export type TransactionStatus
  = | 'AWAITING_PAYMENT'
    | 'PAYMENT_COMPLETED'
    | 'PAYMENT_EXPIRED'
    | 'PAYMENT_FAILED'
    | 'PROCESSING_PAYMENT'
    | 'WRONG_AMOUNT'

export type UserTransactionSummary = {
  country: string
  localAmount: string
  merchant: string
  time: string
  usdcAmount: string
}
