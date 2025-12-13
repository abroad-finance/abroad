import { z } from 'zod'

import { JsonValueSchema } from '../../../core/types/json'

// Message emitted to notify a specific user via WebSocket bridge
export const UserNotificationMessageSchema = z
  .object({
    id: z.string().trim().min(1).optional(), // backward‑compat alias for userId
    // Accept either a JSON string or any JSON-serializable value
    payload: JsonValueSchema.optional(),
    type: z.string().trim().min(1), // Socket.IO event name
    userId: z.string().trim().min(1).optional(),
  })
  .refine(d => Boolean(d.userId || d.id), {
    message: 'userId or id must be provided',
  })

export type UserNotificationMessage = z.infer<typeof UserNotificationMessageSchema>
