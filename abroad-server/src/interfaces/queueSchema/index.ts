import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'
import { z } from 'zod'

export type JsonObject = { [key: string]: JsonValue }
export type JsonPrimitive = boolean | null | number | string
export type JsonValue = JsonObject | JsonPrimitive | JsonValue[]

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const PaymentSentMessageSchema = z.object({
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  paymentMethod: z.nativeEnum(PaymentMethod),
  targetCurrency: z.nativeEnum(TargetCurrency),
})

export type PaymentSentMessage = z.infer<typeof PaymentSentMessageSchema>

// Message emitted when a payment provider (e.g., Transfero) reports a status update
export const PaymentStatusUpdatedMessageSchema = z.object({
  amount: z.number().nonnegative().optional(),
  currency: z.nativeEnum(TargetCurrency),
  externalId: z.string().min(1), // e.g., Transfero ExternalId to correlate
  provider: z.literal('transfero').default('transfero'),
  status: z.string().min(1), // raw provider status, e.g., Processing, Completed
})

export type PaymentStatusUpdatedMessage = z.infer<typeof PaymentStatusUpdatedMessageSchema>

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
