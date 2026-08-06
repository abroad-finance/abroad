import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import { z } from 'zod'

import { SUPPORTED_PAYMENT_METHODS } from '../../payments/application/supportedPaymentMethods'

/**
 * Runtime shape of a quote request.
 *
 * These live in application rather than beside the TSOA contracts because two
 * transports validate against them: the REST controllers and the partner MCP
 * tool surface. Keeping them here lets the MCP path depend on the domain
 * instead of reaching into another module's HTTP layer.
 *
 * `interfaces/http/contracts.ts` re-exports each one, so the wire contract and
 * the generated spec are unchanged.
 */
export const quoteRequestSchema = z.object({
  amount: z.number().positive(),
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  target_currency: z.enum(TargetCurrency),
})

export const onrampQuoteRequestSchema = z.object({
  crypto_currency: z.enum(CryptoCurrency),
  // The fiat the customer pays. The crypto they receive is derived from it.
  fiat_amount: z.number().positive(),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  target_currency: z.enum(TargetCurrency),
})

export const reverseQuoteRequestSchema = z.object({
  crypto_currency: z.enum(CryptoCurrency),
  network: z.enum(BlockchainNetwork),
  payment_method: z.enum(SUPPORTED_PAYMENT_METHODS),
  source_amount: z.number().positive(),
  target_currency: z.enum(TargetCurrency),
})
