import { z } from 'zod'

export const personaWebhookSchema = z.object({
  data: z.object({
    attributes: z.object({
      payload: z.object({
        data: z.object({
          attributes: z.object({
            status: z.enum([
              'approved',
              'completed',
              'created',
              'declined',
              'expired',
              'failed',
              'needs_review',
              'pending',
            ]),
          }),
          id: z.string().min(1),
        }),
      }),
    }),
  }),
}).loose()

export type PersonaStatus = PersonaWebhookPayload['data']['attributes']['payload']['data']['attributes']['status']
export type PersonaWebhookPayload = z.infer<typeof personaWebhookSchema>
