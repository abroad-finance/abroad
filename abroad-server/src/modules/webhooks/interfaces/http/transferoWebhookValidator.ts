import { TargetCurrency } from '@prisma/client'
import { z } from 'zod'

import { PaymentStatusUpdatedMessage } from '../../../../platform/messaging/queueSchema'

const transferoWebhookSchema = z.object({
  Amount: z.number().optional(),
  Currency: z.nativeEnum(TargetCurrency),
  PaymentId: z.string().min(1),
  PaymentStatus: z.string().min(1),
}).loose()

type TransferoWebhookValidationResult
  = | { errors: string, success: false }
    | { message: PaymentStatusUpdatedMessage, success: true }

export function parseTransferoWebhook(
  body: Record<string, unknown>,
): TransferoWebhookValidationResult {
  const parsed = transferoWebhookSchema.safeParse(body)

  if (!parsed.success) {
    return {
      errors: JSON.stringify(parsed.error.issues),
      success: false,
    }
  }

  const { Amount, Currency, PaymentId, PaymentStatus } = parsed.data

  return {
    message: {
      amount: typeof Amount === 'number' ? Amount : 0,
      currency: Currency ?? TargetCurrency.BRL,
      externalId: PaymentId,
      provider: 'transfero',
      status: PaymentStatus,
    },
    success: true,
  }
}
