import { z } from 'zod'

export const BinanceBalanceUpdatedMessageSchema = z.object({}).strict()

export type BinanceBalanceUpdatedMessage = z.infer<typeof BinanceBalanceUpdatedMessageSchema>
