import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'
import z from 'zod'

export const PaymentSentMessageSchema = z.object({
  amount: z.number().positive(),
  blockchain: z.enum(BlockchainNetwork),
  cryptoCurrency: z.enum(CryptoCurrency),
  paymentMethod: z.enum(PaymentMethod),
  targetCurrency: z.enum(TargetCurrency),
})

export type PaymentSentMessage = z.infer<typeof PaymentSentMessageSchema>

// Message emitted when a payment provider (e.g., Transfero) reports a status update
export const PaymentStatusUpdatedMessageSchema = z.object({
  amount: z.number().nonnegative().optional(),
  currency: z.enum(TargetCurrency),
  externalId: z.string().min(1), // e.g., Transfero ExternalId to correlate
  provider: z.enum(['transfero']).default('transfero'),
  status: z.string().min(1), // raw provider status, e.g., Processing, Completed
})

export type PaymentStatusUpdatedMessage = z.infer<typeof PaymentStatusUpdatedMessageSchema>
