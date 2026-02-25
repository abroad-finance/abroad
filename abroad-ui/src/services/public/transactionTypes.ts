import type { TargetCurrency } from '../../api'

export type TransactionStatus =
  | 'AWAITING_PAYMENT'
  | 'PROCESSING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'PAYMENT_COMPLETED'
  | 'WRONG_AMOUNT'

export type PaymentMethod = 'PIX' | 'BRE_B' | 'BOTON'
export type Country = 'BR' | 'CO'
export type CryptoCurrency = 'USDC' | 'USDT' | 'ETH' | 'SOL'
export type BlockchainNetwork = 'STELLAR' | 'SOLANA' | 'CELO' | 'ETHEREUM'

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
  id: string
  partnerUserId: string
  accountNumber: string
  status: TransactionStatus
  createdAt: string
  quoteId: string
  onChainId: string | null
  refundOnChainId: string | null
  taxId: string | null
  externalId: string | null
  qrCode: string | null
  exchangeHandoffAt: string | null
  quote: QuoteData
}

export interface PaginatedTransactionList {
  page: number
  pageSize: number
  total: number
  transactions: TransactionData[]
}

export type UserTransactionSummary = {
  country: string
  localAmount: string
  merchant: string
  time: string
  usdcAmount: string
}
