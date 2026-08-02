import type { Request as ExpressRequest } from 'express'

import { readPartnerPortalClientIp } from '../../../../../modules/partners/interfaces/http/partnerPortalClientIp'

const requestWith = (
  forwardedFor: string | undefined,
  remoteAddress = '127.0.0.1',
): ExpressRequest => ({
  header: jest.fn(() => forwardedFor),
  socket: { remoteAddress },
}) as unknown as ExpressRequest

describe('readPartnerPortalClientIp', () => {
  it('uses the trusted edge address while ignoring a client-supplied prefix', () => {
    expect(readPartnerPortalClientIp(requestWith(
      '198.51.100.99, 203.0.113.10, 35.191.0.1',
    ))).toBe('203.0.113.10')
  })

  it('supports a single forwarded address and validated IPv6 socket fallback', () => {
    expect(readPartnerPortalClientIp(requestWith('203.0.113.10'))).toBe('203.0.113.10')
    expect(readPartnerPortalClientIp(requestWith(undefined, '2001:db8::1'))).toBe('2001:db8::1')
  })

  it('returns one shared non-sensitive bucket when no valid address is available', () => {
    expect(readPartnerPortalClientIp(requestWith('not-an-ip', 'also-invalid'))).toBe('unavailable')
  })
})
