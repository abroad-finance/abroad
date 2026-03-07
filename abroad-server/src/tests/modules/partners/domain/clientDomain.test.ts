import { clientDomainToString, normalizeClientDomainInput, parseClientDomain } from '../../../../modules/partners/domain/clientDomain'

describe('clientDomain', () => {
  it('normalizes origins and bare hosts into a canonical client domain', () => {
    const originDomain = parseClientDomain('https://App.Abroad.Finance')
    const bareHostDomain = parseClientDomain('app.abroad.finance/swap?utm_source=minipay')

    expect(originDomain).not.toBeNull()
    expect(bareHostDomain).not.toBeNull()

    if (!originDomain || !bareHostDomain) {
      throw new Error('Expected valid client domains')
    }

    expect(clientDomainToString(originDomain)).toBe('app.abroad.finance')
    expect(clientDomainToString(bareHostDomain)).toBe('app.abroad.finance')
  })

  it('rejects malformed client domain values', () => {
    expect(parseClientDomain('not a domain value')).toBeNull()
    expect(parseClientDomain('')).toBeNull()
  })

  it('builds storage fields for canonical client domains and clears blanks', () => {
    expect(normalizeClientDomainInput('https://App.Abroad.Finance/path')).toEqual({
      clientDomain: 'app.abroad.finance',
      clientDomainHash: expect.any(String),
    })
    expect(normalizeClientDomainInput('')).toEqual({
      clientDomain: null,
      clientDomainHash: null,
    })
  })
})
