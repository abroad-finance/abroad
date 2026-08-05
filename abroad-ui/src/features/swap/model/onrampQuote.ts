import { z } from 'zod'

import { quoteFeeSchema } from './quote'

/**
 * A priced fiat-to-crypto purchase.
 *
 * The field names keep the same meaning they have on a payout quote —
 * `sourceAmount` is always the crypto leg and `targetAmount` always the fiat
 * leg — so only who pays which leg changes. On an onramp the customer pays
 * `targetAmount` and receives `sourceAmount`.
 */
export const onrampQuoteSnapshotSchema = z.object({
  corridorKey: z.string().min(1).max(256),
  expiresAt: z.number().int().positive(),
  fee: quoteFeeSchema.nullable(),
  id: z.string().min(1).max(128),
  network: z.string().min(1).max(64),
  rail: z.literal('PIX'),
  /** Crypto the customer receives. */
  sourceAmount: z.number().finite().positive(),
  sourceCurrency: z.enum(['USDC', 'USDT']),
  /** Fiat the customer pays. */
  targetAmount: z.number().finite().positive(),
  targetCurrency: z.literal('BRL'),
}).strict()

export type OnrampQuoteSnapshot = z.infer<typeof onrampQuoteSnapshotSchema>

/**
 * What the customer needs in order to fund the purchase. `expiresAt` is null
 * when the provider did not set an expiry on the code.
 */
export const paymentInstructionsSchema = z.object({
  brCode: z.string().min(1).max(4096),
  expiresAt: z.number().int().positive().nullable(),
}).strict()

export type PaymentInstructions = z.infer<typeof paymentInstructionsSchema>

export const isOnrampQuoteExpired = (
  quote: OnrampQuoteSnapshot,
  now: number = Date.now(),
): boolean => quote.expiresAt <= now
