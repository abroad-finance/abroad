import { z } from 'zod'

export const ExchangeBalanceUpdatedMessageSchema = z.object({
  provider: z.enum(['binance', 'transfero']),
  /**
   * `observed` carries real evidence the balance moved — a provider webhook —
   * and resumes every waiting step at once. `speculative` is the periodic
   * safety net that recovers a lost webhook; it honours each step's own
   * backoff, so a permanently parked trade stops re-reading the provider on
   * every tick. Defaulting to `observed` keeps an in-flight message published
   * before this field existed on the fast path.
   */
  trigger: z.enum(['observed', 'speculative']).default('observed'),
}).strict()

export type ExchangeBalanceUpdatedMessage = z.infer<typeof ExchangeBalanceUpdatedMessageSchema>
