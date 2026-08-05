import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import { z } from 'zod'

import { SUPPORTED_PAYMENT_METHODS, SupportedPaymentMethod } from '../../../payments/application/supportedPaymentMethods'

export const quoteRequestSchema = z.object({
  amount: z.number().positive(),
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  target_currency: z.enum(TargetCurrency),
})

export type QuoteRequest = {
  amount: number
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  target_currency: TargetCurrency
}

export const onrampQuoteRequestSchema = z.object({
  crypto_currency: z.enum(CryptoCurrency),
  // The fiat the customer pays. The crypto they receive is derived from it.
  fiat_amount: z.number().positive(),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  target_currency: z.enum(TargetCurrency),
})

export type OnrampQuoteRequest = {
  crypto_currency: CryptoCurrency
  fiat_amount: number
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  target_currency: TargetCurrency
}

export const reverseQuoteRequestSchema = z.object({
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  source_amount: z.number().positive(),
  target_currency: z.enum(TargetCurrency),
})

export type ReverseQuoteRequest = {
  crypto_currency: CryptoCurrency
  network: BlockchainNetwork
  payment_method: SupportedPaymentMethod
  source_amount: number
  target_currency: TargetCurrency
}
