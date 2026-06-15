import { z } from 'zod'

// Transfero balance notifications arrive in two shapes:
// - deposit-order callbacks: flat numeric `amount`, with createdAt/referenceId/
//   status/taxId present (externalId may be absent or null).
// - credit-transaction callbacks (e.g. on-chain crypto deposits): `amount` is a
//   nested { amount, currency } object and the deposit-order-only fields are absent.
// Downstream we only need to know a Transfero balance changed (the handler
// publishes a coarse { provider: 'transfero' } signal), so accept both shapes and
// treat all descriptive fields as optional. `amount` (number or object) is the
// one required field, as a minimal guard against empty/garbage payloads.
const balanceAmountSchema = z.union([
  z.number(),
  z.object({}).loose(),
])

const transferoBalanceWebhookSchema = z.object({
  accountId: z.string().min(1).nullish(),
  amount: balanceAmountSchema,
  blockchain: z.string().min(1).nullish(),
  createdAt: z.string().min(1).nullish(),
  externalId: z.string().min(1).nullish(),
  referenceId: z.string().min(1).nullish(),
  status: z.string().min(1).nullish(),
  taxId: z.string().min(1).nullish(),
  taxIdCountry: z.string().min(1).nullish(),
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
