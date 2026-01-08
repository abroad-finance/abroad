import { TargetCurrency } from '@prisma/client'
import { z } from 'zod'

// Message emitted when a payment provider (e.g., Transfero) reports a status update
export const PaymentStatusUpdatedMessageSchema = z.object({
  amount: z.number().nonnegative().optional(),
  currency: z.nativeEnum(TargetCurrency),
  externalId: z.string().min(1), // e.g., Transfero ExternalId to correlate
  provider: z.enum(['transfero', 'breb']).default('transfero'),
  status: z.string().min(1), // raw provider status, e.g., Processing, Completed
})

export type PaymentStatusUpdatedMessage = z.infer<typeof PaymentStatusUpdatedMessageSchema>
