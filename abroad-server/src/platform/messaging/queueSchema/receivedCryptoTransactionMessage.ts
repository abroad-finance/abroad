import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { z } from 'zod'

export const ReceivedCryptoTransactionMessageSchema = z.object({
  addressFrom: z.string().min(1, 'Address from is required'),
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  flags: z.array(z.string().trim().min(1).max(50)).max(10).transform(
    (flags) => {
      const uniqueFlags = Array.from(new Set(flags))
      return uniqueFlags.length > 0 ? uniqueFlags : undefined
    },
  ).optional(),
  onChainId: z.string().min(1),
  transactionId: z.string().uuid(),
})

export type ReceivedCryptoTransactionMessage = z.infer<typeof ReceivedCryptoTransactionMessageSchema>
