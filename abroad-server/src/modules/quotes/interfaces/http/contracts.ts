import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import { SupportedPaymentMethod } from '../../../payments/application/supportedPaymentMethods'

// The runtime schemas live in application so both this transport and the
// partner MCP tool surface can validate against the same objects.
export {
  onrampQuoteRequestSchema,
  quoteRequestSchema,
  reverseQuoteRequestSchema,
} from '../../application/quoteRequestSchemas'

export type OnrampQuoteRequest = {
  crypto_currency: CryptoCurrency
  fiat_amount: number
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  target_currency: TargetCurrency
}

export type QuoteRequest = {
  amount: number
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  target_currency: TargetCurrency
}

export type ReverseQuoteRequest = {
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  source_amount: number
  target_currency: TargetCurrency
}
