import type {
  AcceptTransactionRequest, AcceptTransactionResponse, ChainFamily, TargetCurrency, WalletConnectMetadata,
} from '../../api'

// Re-export AcceptTransactionRequest and AcceptTransactionResponse for use in publicApi.ts
export type { AcceptTransactionRequest, AcceptTransactionResponse }

/**
 * @deprecated Use PaymentContext from ../../api instead
 * This local type is kept for backwards compatibility but should be removed
 * once all usages are migrated to the API type.
 */
export type NotifyMetadata = {
  endpoint: null | string
  required: boolean
}

export type NotifyPaymentRequest = {
  blockchain: string
  on_chain_tx: string
  transaction_id: string
}

/**
 * Public corridor configuration type.
 */
export type PublicCorridor = {
  blockchain: string
  chainFamily: ChainFamily
  chainId: string
  cryptoCurrency: string
  maxAmount: null | number
  minAmount: null | number
  notify: NotifyMetadata
  paymentMethod: string
  targetCurrency: TargetCurrency
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
