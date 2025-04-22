import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import z from 'zod'

export const PaymentSentMessageSchema = z.object({
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  targetCurrency: z.nativeEnum(TargetCurrency),
})

export type PaymentSentMessage = z.infer<typeof PaymentSentMessageSchema>
