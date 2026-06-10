import { isKycExemptByAmount, isKycTemporarilyDisabled, KYC_EXEMPTION_USD_THRESHOLD } from '../../../app/config/kyc'

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

describe('isKycTemporarilyDisabled', () => {
  const originalEnforceKyc = process.env.ENFORCE_KYC

  afterEach(() => {
    if (originalEnforceKyc === undefined) {
      delete process.env.ENFORCE_KYC
    }
    else {
      process.env.ENFORCE_KYC = originalEnforceKyc
    }
  })

  it('disables KYC when ENFORCE_KYC is unset', () => {
    delete process.env.ENFORCE_KYC
    expect(isKycTemporarilyDisabled()).toBe(true)
  })

  it('keeps KYC enforced when ENFORCE_KYC=true', () => {
    process.env.ENFORCE_KYC = 'true'
    expect(isKycTemporarilyDisabled()).toBe(false)
  })

  it('exempts every amount while KYC is disabled', () => {
    delete process.env.ENFORCE_KYC
    expect(isKycExemptByAmount(KYC_EXEMPTION_USD_THRESHOLD + 1)).toBe(true)
    expect(isKycExemptByAmount(1_000_000)).toBe(true)
  })

  it('still rejects negative amounts while KYC is disabled', () => {
    delete process.env.ENFORCE_KYC
    expect(() => isKycExemptByAmount(-1)).toThrow('Amount cannot be negative')
  })
})
