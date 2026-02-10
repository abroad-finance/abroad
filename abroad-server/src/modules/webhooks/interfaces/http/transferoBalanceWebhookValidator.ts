import { z } from 'zod'

const transferoBalanceWebhookSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().nonnegative(),
  blockchain: z.string().min(1),
  createdAt: z.string().min(1).refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'createdAt must be a valid ISO date string',
  }),
  externalId: z.string().min(1),
  referenceId: z.string().min(1),
  status: z.string().min(1),
  taxId: z.string().min(1),
  taxIdCountry: z.string().min(1),
}).loose()

type TransferoBalanceWebhookValidationResult
  = | { errors: string, success: false }
    | { payload: z.infer<typeof transferoBalanceWebhookSchema>, success: true }

export function parseTransferoBalanceWebhook(
  body: Record<string, unknown>,
): TransferoBalanceWebhookValidationResult {
  const parsed = transferoBalanceWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return {
      errors: JSON.stringify(parsed.error.issues),
      success: false,
    }
  }

  return { payload: parsed.data, success: true }
}

