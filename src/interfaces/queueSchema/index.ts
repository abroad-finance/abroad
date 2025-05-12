import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'
import z from 'zod'

export const PaymentSentMessageSchema = z.object({
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  paymentMethod: z.nativeEnum(PaymentMethod),
  targetCurrency: z.nativeEnum(TargetCurrency),
})

export type PaymentSentMessage = z.infer<typeof PaymentSentMessageSchema>
