import { z } from 'zod'

import type { QueueName } from '../queues'

export const DeadLetterMessageSchema = z.object({
  error: z.string().optional(),
  originalQueue: z.string(),
  payload: z.unknown(),
  reason: z.string(),
})

export type DeadLetterMessage = {
  error?: string
  originalQueue: QueueName | string
  payload: unknown
  reason: string
}
