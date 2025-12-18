import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import { z } from 'zod'

import { SUPPORTED_PAYMENT_METHODS } from '../../../modules/payments/application/supportedPaymentMethods'

export const PaymentSentMessageSchema = z.object({
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  paymentMethod: z.enum(SUPPORTED_PAYMENT_METHODS),
  targetCurrency: z.nativeEnum(TargetCurrency),
})

export type PaymentSentMessage = z.infer<typeof PaymentSentMessageSchema>
