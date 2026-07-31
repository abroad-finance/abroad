import { PartnerPortalPasswordService, PartnerPortalPasswordValidationError } from '../../../../modules/partners/application/PartnerPortalPasswordService'

describe('PartnerPortalPasswordService', () => {
  const service = new PartnerPortalPasswordService()
  const password = 'correct horse battery staple'

  it('builds salted memory-hard verifiers without retaining plaintext', async () => {
    const first = await service.buildVerifier(password)
    const second = await service.buildVerifier(password)

    expect(first).toMatch(/^scrypt-v1\$N=32768,r=8,p=1\$/)
    expect(second).toMatch(/^scrypt-v1\$N=32768,r=8,p=1\$/)
    expect(first).not.toBe(second)
    expect(first).not.toContain(password)
    await expect(service.verify(password, first)).resolves.toBe(true)
    await expect(service.verify('incorrect portal password', first)).resolves.toBe(false)
  })

  it('rejects passwords outside the bounded provisioning policy', async () => {
    await expect(service.buildVerifier('too-short')).rejects.toThrow(
      PartnerPortalPasswordValidationError,
    )
    await expect(service.buildVerifier('p'.repeat(129))).rejects.toThrow(
      'Password must be between 12 and 128 characters',
    )
  })

  it('fails closed for malformed or unsafe verifier parameters', async () => {
    await expect(service.verify(password, 'not-a-verifier')).resolves.toBe(false)
    await expect(service.verify(
      password,
      'scrypt-v1$N=1048576,r=8,p=1$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWY$YWJj',
    )).resolves.toBe(false)
  })

  it('fails closed for login passwords outside the accepted length', async () => {
    const verifier = await service.buildVerifier(password)

    await expect(service.verify('short', verifier)).resolves.toBe(false)
    await expect(service.verify('p'.repeat(129), verifier)).resolves.toBe(false)
  })
})
