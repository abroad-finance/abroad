import { z } from 'zod'

import type {
  AcceptTransactionRequest, AcceptTransactionResponse, ChainFamily, TargetCurrency, WalletConnectMetadata,
} from '../../api'

// Re-export AcceptTransactionRequest and AcceptTransactionResponse for use in publicApi.ts
export type { AcceptTransactionRequest, AcceptTransactionResponse }

export type NotifyPaymentRequest = {
  blockchain: string
  on_chain_tx: string
  transaction_id: string
}

export type PaymentNotifyMetadata = {
  endpoint: null | string
  required: boolean
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
  notify: PaymentNotifyMetadata
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
  fee?: null | {
    amount: string
    currency: 'USDC' | 'USDT'
    type: 'combined' | 'fixed' | 'none' | 'percentage'
  }
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

export const publicCorridorResponseSchema: z.ZodType<PublicCorridorResponse> = z.object({
  corridors: z.array(z.object({
    blockchain: z.string().min(1).max(64),
    chainFamily: z.enum([
      'evm',
      'solana',
      'stellar',
    ]),
    chainId: z.string().min(1).max(128),
    cryptoCurrency: z.string().min(1).max(32),
    maxAmount: z.number().finite().nonnegative().nullable(),
    minAmount: z.number().finite().nonnegative().nullable(),
    notify: z.object({
      endpoint: z.string().url().max(2_048).nullable(),
      required: z.boolean(),
    }).strict(),
    paymentMethod: z.string().min(1).max(32),
    targetCurrency: z.enum(['BRL', 'COP']),
    walletConnect: z.object({
      chainId: z.string().min(1).max(128),
      events: z.array(z.string().max(128)).max(64),
      methods: z.array(z.string().max(128)).max(64),
      namespace: z.string().min(1).max(64),
    }).strict(),
  }).strict()).max(100),
}).strict()

export const quoteResponseSchema: z.ZodType<QuoteResponse> = z.object({
  expiration_time: z.number().int().positive(),
  fee: z.object({
    amount: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
    currency: z.enum(['USDC', 'USDT']),
    type: z.enum([
      'combined',
      'fixed',
      'none',
      'percentage',
    ]),
  }).strict().nullable().optional(),
  quote_id: z.string().min(1).max(128),
  value: z.number().finite().positive(),
}).strict()
