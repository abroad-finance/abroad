import { KYCTier } from '@prisma/client'

import { getNextTier } from '../../constants/workflowRules'

describe('workflowRules.getNextTier', () => {
  it('throws when amount is negative', () => {
    expect(() => getNextTier('BR', -1)).toThrow('Amount cannot be negative')
  })

  it('returns null when existing tier already satisfies the requirement', () => {
    const tier = getNextTier('BR', 5_000, KYCTier.ENHANCED)

    expect(tier).toBeNull()
  })

  it('promotes BR users to ENHANCED when amount exceeds threshold', () => {
    const tier = getNextTier('BR', 20_000, KYCTier.NONE)

    expect(tier).toBe(KYCTier.ENHANCED)
  })

  it('requires STANDARD tier for CO transactions below the enhanced threshold', () => {
    const tier = getNextTier('CO', 5_000, KYCTier.NONE)

    expect(tier).toBe(KYCTier.STANDARD)
  })

  it('requires ENHANCED tier for CO transactions above the standard limit', () => {
    const tier = getNextTier('CO', 25_000, KYCTier.BASIC)

    expect(tier).toBe(KYCTier.ENHANCED)
  })
})
