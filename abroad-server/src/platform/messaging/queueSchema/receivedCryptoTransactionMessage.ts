import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { z } from 'zod'

export const ReceivedCryptoTransactionMessageSchema = z.object({
  addressFrom: z.string().min(1, 'Address from is required'),
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  onChainId: z.string().min(1),
  transactionId: z.string().uuid(),
})

export type ReceivedCryptoTransactionMessage = z.infer<typeof ReceivedCryptoTransactionMessageSchema>
