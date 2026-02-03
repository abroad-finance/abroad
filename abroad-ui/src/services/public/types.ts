export type AcceptTransactionRequest = {
  account_number: string
  qr_code?: null | string
  quote_id: string
  redirectUrl?: string
  tax_id?: string
  user_id: string
}

export type AcceptTransactionResponse = {
  id: null | string
  kycLink: null | string
  payment_context?: null | PaymentContext
  transaction_reference: null | string
}

export type ChainFamily = 'evm' | 'solana' | 'stellar'

export type NotifyMetadata = {
  endpoint: null | string
  required: boolean
}

export type NotifyPaymentRequest = {
  blockchain: string
  on_chain_tx: string
  transaction_id: string
}

export type PaymentContext = {
  amount: number
  blockchain: string
  chainFamily: ChainFamily
  chainId: string
  cryptoCurrency: string
  decimals: null | number
  depositAddress: string
  memo: null | string
  memoType: 'text' | null
  mintAddress: null | string
  notify: NotifyMetadata
  rpcUrl: null | string
}

export type PublicCorridor = {
  blockchain: string
  chainFamily: ChainFamily
  chainId: string
  cryptoCurrency: string
  maxAmount: null | number
  minAmount: null | number
  notify: NotifyMetadata
  paymentMethod: string
  targetCurrency: string
  walletConnect: WalletConnectMetadata
}

export type PublicCorridorResponse = {
  corridors: PublicCorridor[]
}

export type QuoteRequest = {
  amount: number
  crypto_currency: string
  network: string
  payment_method: string
  target_currency: string
}

export type QuoteResponse = {
  expiration_time: number
  quote_id: string
  value: number
}

export type ReverseQuoteRequest = {
  crypto_currency: string
  network: string
  payment_method: string
  source_amount: number
  target_currency: string
}

export type WalletConnectMetadata = {
  chainId: string
  events: string[]
  methods: string[]
  namespace: string
}
