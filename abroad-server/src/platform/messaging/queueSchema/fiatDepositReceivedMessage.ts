import { TargetCurrency } from '@prisma/client'
import { z } from 'zod'

/**
 * A customer's inbound fiat deposit landed and is spendable. Carries only what
 * the consumer needs to reconcile: the provider's own deposit id is
 * authoritative, and the amount here is what was actually credited rather than
 * what was quoted.
 */
export const FiatDepositReceivedMessageSchema = z.object({
  amount: z.number().positive(),
  currency: z.nativeEnum(TargetCurrency),
  endToEndId: z.string().min(1).nullable(),
  /** Full payer tax id, recorded for reconciliation. Not a delivery gate. */
  payerTaxId: z.string().min(1).nullable(),
  provider: z.string().min(1),
  providerDepositId: z.string().min(1),
  transactionId: z.string().uuid(),
})

export type FiatDepositReceivedMessage = z.infer<typeof FiatDepositReceivedMessageSchema>
