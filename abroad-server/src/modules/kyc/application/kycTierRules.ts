import { KYCTier } from '@prisma/client'

import { isKycExemptByAmount } from '../../../app/config/kyc'

export type KycCountry = 'BR' | 'CO'

// Numerical mapping for KYC tier comparison
const tierOrder: Record<KYCTier, number> = {
  [KYCTier.BASIC]: 1,
  [KYCTier.ENHANCED]: 3,
  [KYCTier.NONE]: 0,
  [KYCTier.STANDARD]: 2,
}

const tierRule: Record<KycCountry, (amount: number) => KYCTier> = {
  BR: amount => amount < 1800 ? KYCTier.BASIC : KYCTier.ENHANCED,
  CO: amount => amount < 10000 ? KYCTier.BASIC : KYCTier.ENHANCED,
}

export function getNextTier(
  country: KycCountry,
  amount: number,
  existingTier: KYCTier = KYCTier.NONE,
): KYCTier | null {
  if (amount < 0) {
    throw new Error('Amount cannot be negative')
  }

  if (isKycExemptByAmount(amount)) {
    return null
  }

  const requiredTier = tierRule[country](amount)
  if (tierOrder[existingTier] >= tierOrder[requiredTier]) {
    return null
  }

  return requiredTier
}
