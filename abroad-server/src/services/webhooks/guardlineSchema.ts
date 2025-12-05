import { z } from 'zod'

export const guardlineWebhookSchema = z.object({
  workflow_instance_id: z.string().min(1).optional(),
}).loose()

export type GuardlineWebhookPayload = z.infer<typeof guardlineWebhookSchema>

export interface GuardlineWebhookRequest {
  workflow_instance_id?: string
}
