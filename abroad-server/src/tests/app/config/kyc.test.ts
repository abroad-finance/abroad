import { isKycExemptByAmount, KYC_EXEMPTION_USD_THRESHOLD } from '../../../app/config/kyc'

describe('isKycExemptByAmount', () => {
  it('throws when the amount is negative', () => {
    expect(() => isKycExemptByAmount(-1)).toThrow('Amount cannot be negative')
  })

  it('returns true when the amount is within the exemption threshold', () => {
    expect(isKycExemptByAmount(KYC_EXEMPTION_USD_THRESHOLD)).toBe(true)
  })

  it('returns false when the amount exceeds the exemption threshold', () => {
    expect(isKycExemptByAmount(KYC_EXEMPTION_USD_THRESHOLD + 1)).toBe(false)
  })
})
