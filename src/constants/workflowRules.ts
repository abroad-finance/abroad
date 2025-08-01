import { KYCTier } from '@prisma/client'

/* ---------------------------------------------------------------------------
 * Lookup tables
 * ------------------------------------------------------------------------- */
type Country = 'BR' | 'CO'

const tierRule: Record<Country, (amount: number) => KYCTier> = {
  BR: amt => (amt <= 10_000 ? KYCTier.BASIC : KYCTier.ENHANCED),
  CO: amt =>
    amt <= 150
      ? KYCTier.BASIC
      : amt <= 10_000
        ? KYCTier.STANDARD
        : KYCTier.ENHANCED,
}

const workflowByTier: Record<Country, Record<KYCTier, null | string>> = {
  BR: {
    [KYCTier.BASIC]: '39ab7843d047521e', // ≤ 10 000 BRL :contentReference[oaicite:9]{index=9}
    [KYCTier.ENHANCED]: 'be9d1560c0b88e24',
    [KYCTier.NONE]: null,
    [KYCTier.STANDARD]: null,
  },
  CO: {
    [KYCTier.BASIC]: 'c0a1b7a51efa867e', // ≤ 150 USD    :contentReference[oaicite:11]{index=11}
    [KYCTier.ENHANCED]: 'f39d58daf6752bea', // > 10 000 USD :contentReference[oaicite:13]{index=13}
    [KYCTier.NONE]: null,
    [KYCTier.STANDARD]: '363fcc81f21f8f1f',
  },
}

/* ---------------------------------------------------------------------------
 * Smart workflow resolver
 * ------------------------------------------------------------------------- */
/**
 * Decide whether the user must run a new Guardline workflow.
 *
 * @param country        "BR" or "CO"
 * @param amount         Transaction amount (BRL for BR, USD for CO)
 * @param existingTier   Highest KYC tier the user has already passed
 *                       — persist this per‑user in your DB / session.
 * @returns `string | null`
 *          → `workflowDefinitionId` to launch if *more* KYC is needed
 *          → `null` if the existing data already satisfies this operation
 */
export function nextWorkflowId(
  country: Country,
  amount: number,
  existingTier: KYCTier = KYCTier.NONE,
): null | string {
  if (amount < 0) throw new Error('Amount cannot be negative')

  const requiredTier = tierRule[country](amount)
  if (existingTier >= requiredTier) return null // Skip redundant KYC 🎉

  return workflowByTier[country][requiredTier]
}
