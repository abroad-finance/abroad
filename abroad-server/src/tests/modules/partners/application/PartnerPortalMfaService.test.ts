import { PartnerPortalMfaService, PartnerPortalMfaValidationError } from '../../../../modules/partners/application/PartnerPortalMfaService'

const RFC_6238_SHA1_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('PartnerPortalMfaService', () => {
  const service = new PartnerPortalMfaService()

  it('verifies RFC 6238 SHA-1 vectors using the configured six digits', () => {
    expect(service.verifyTotp(
      RFC_6238_SHA1_SECRET,
      '287082',
      null,
      new Date(59_000),
    )).toBe(1n)
    expect(service.verifyTotp(
      RFC_6238_SHA1_SECRET,
      '081804',
      null,
      new Date(1_111_111_109_000),
    )).toBe(37_037_036n)
  })

  it('accepts one adjacent time step and rejects replayed counters', () => {
    const acceptedCounter = service.verifyTotp(
      RFC_6238_SHA1_SECRET,
      '081804',
      null,
      new Date(1_111_111_111_000),
    )

    expect(acceptedCounter).toBe(37_037_036n)
    expect(() => service.verifyTotp(
      RFC_6238_SHA1_SECRET,
      '081804',
      acceptedCounter,
      new Date(1_111_111_111_000),
    )).toThrow(new PartnerPortalMfaValidationError('Authentication code is invalid'))
  })

  it('generates an authenticator-compatible enrollment without leaking an unescaped label', () => {
    const enrollment = service.buildEnrollment(
      'operator+finance@decaf.so',
      'Decaf & Co',
    )
    const uri = new URL(enrollment.otpauthUri)

    expect(uri.protocol).toBe('otpauth:')
    expect(decodeURIComponent(uri.pathname)).toBe('/Abroad:Decaf & Co (operator+finance@decaf.so)')
    expect(uri.searchParams.get('algorithm')).toBe('SHA1')
    expect(uri.searchParams.get('digits')).toBe('6')
    expect(uri.searchParams.get('issuer')).toBe('Abroad')
    expect(uri.searchParams.get('period')).toBe('30')
    expect(uri.searchParams.get('secret')).toBe(enrollment.secret)
    expect(enrollment.manualEntryKey.replaceAll(' ', '')).toBe(enrollment.secret)
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/u)
  })

  it('generates ten unique, single-format recovery codes with stable normalized hashes', () => {
    const recoveryCodes = service.generateRecoveryCodes()

    expect(recoveryCodes).toHaveLength(10)
    expect(new Set(recoveryCodes.map(code => code.plaintext)).size).toBe(10)
    for (const recoveryCode of recoveryCodes) {
      expect(recoveryCode.plaintext).toMatch(/^(?:[A-Z2-7]{4}-){3}[A-Z2-7]{4}$/u)
      expect(service.hashRecoveryCode(recoveryCode.plaintext.toLowerCase())).toBe(
        recoveryCode.codeHash,
      )
    }
  })

  it('rejects malformed codes and invalid base32 secrets', () => {
    expect(() => service.hashRecoveryCode('short')).toThrow('Recovery code is invalid')
    expect(() => service.verifyTotp(RFC_6238_SHA1_SECRET, '12345', null)).toThrow(
      'Authentication code is invalid',
    )
    expect(() => service.verifyTotp('NOT!BASE32', '123456', null)).toThrow(
      'MFA secret is invalid',
    )
  })
})
