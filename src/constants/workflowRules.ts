import { KYCTier } from '@prisma/client'

/* ---------------------------------------------------------------------------
 * Lookup tables
 *
 * Note: KYCTier enum has numerical ordering for proper comparison
 * ------------------------------------------------------------------------- */
type Country = 'BR' | 'CO'

// Numerical mapping for KYC tier comparison
const tierOrder: Record<KYCTier, number> = {
  [KYCTier.BASIC]: 1,
  [KYCTier.ENHANCED]: 3,
  [KYCTier.NONE]: 0,
  [KYCTier.STANDARD]: 2,
}

const tierRule: Record<Country, (amount: number) => KYCTier> = {
  BR: amt => (amt <= 10_000 ? KYCTier.BASIC : KYCTier.ENHANCED),
  CO: amt => amt <= 10_000
    ? KYCTier.STANDARD
    : KYCTier.ENHANCED,
}

export const workflowByTier: Record<Country, Record<KYCTier, null | string>> = {
  BR: {
    [KYCTier.BASIC]: '39ab7843d047521e',
    [KYCTier.ENHANCED]: 'be9d1560c0b88e24',
    [KYCTier.NONE]: null,
    [KYCTier.STANDARD]: null,
  },
  CO: {
    [KYCTier.BASIC]: null,
    [KYCTier.ENHANCED]: 'f39d58daf6752bea',
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
export function getNextTier(
  country: Country,
  amount: number,
  existingTier: KYCTier = KYCTier.NONE,
): KYCTier | null {
  if (amount < 0) throw new Error('Amount cannot be negative')

  const requiredTier = tierRule[country](amount)
  if (tierOrder[existingTier] >= tierOrder[requiredTier]) return null

  return requiredTier
}
