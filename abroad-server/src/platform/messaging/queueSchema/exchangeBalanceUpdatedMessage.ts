import { z } from 'zod'

export const ExchangeBalanceUpdatedMessageSchema = z.object({
  provider: z.enum(['binance', 'transfero']),
}).strict()

export type ExchangeBalanceUpdatedMessage = z.infer<typeof ExchangeBalanceUpdatedMessageSchema>

