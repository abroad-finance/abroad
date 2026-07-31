import { Request } from 'express'

import type { IPartnerService } from '../../../modules/partners/application/contracts/IPartnerService'

import { iocContainer } from '../../../app/container'
import { expressAuthentication } from '../../../app/http/authentication'
import { PartnerPortalSessionService } from '../../../modules/partners/application/PartnerPortalSessionService'

const partnerService: jest.Mocked<IPartnerService> = {
  authenticateBearerToken: jest.fn(),
  getPartnerFromApiKey: jest.fn(),
  getPartnerFromClientDomain: jest.fn(),
} as jest.Mocked<IPartnerService>

const partnerPortalSessionService = {
  verifySession: jest.fn(),
}

jest.mock('../../../app/container', () => ({
  iocContainer: {
    get: jest.fn(() => partnerService),
  },
}))

describe('expressAuthentication', () => {
  const partner = { id: 'p-1' } as unknown as import('@prisma/client').Partner

  beforeEach(() => {
    jest.clearAllMocks()
    partnerService.authenticateBearerToken.mockResolvedValue({
      partner,
      source: 'SEP_24',
    })
    partnerService.getPartnerFromApiKey.mockResolvedValue(partner)
    partnerService.getPartnerFromClientDomain.mockResolvedValue(partner)
    partnerPortalSessionService.verifySession.mockResolvedValue(partner)
    ;(iocContainer.get as jest.Mock).mockImplementation(identifier => (
      identifier === PartnerPortalSessionService ? partnerPortalSessionService : partnerService
    ))
  })

  const buildRequest = (overrides?: Partial<Request>): Request => {
    const baseHeader = jest.fn(() => undefined) as unknown as Request['header']
    const base: Partial<Request> = {
      header: baseHeader,
      headers: {},
    }
    return {
      ...base,
      ...(overrides ?? {}),
    } as Request
  }

  it('authenticates with an API key header', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => (name === 'X-API-Key' ? 'api-key-123' : undefined)) as unknown as Request['header'],
    })

    const result = await expressAuthentication(req, 'ApiKeyAuth')

    expect(result).toEqual({ ...partner, authenticationSource: 'API_KEY' })
    expect(partnerService.getPartnerFromApiKey).toHaveBeenCalledWith('api-key-123')
  })

  it('throws when the API key is missing', async () => {
    const req = buildRequest({ header: jest.fn(() => undefined) as unknown as Request['header'] })

    await expect(expressAuthentication(req, 'ApiKeyAuth')).rejects.toThrow('API key not provided')
    expect(partnerService.getPartnerFromApiKey).not.toHaveBeenCalled()
  })

  it('falls back to the client origin domain for partner auth', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => {
        if (name === 'Origin') {
          return 'https://app.abroad.finance'
        }
        return undefined
      }) as unknown as Request['header'],
    })

    const result = await expressAuthentication(req, 'ApiKeyAuth')

    expect(result).toEqual({ ...partner, authenticationSource: 'CLIENT_DOMAIN' })
    expect(partnerService.getPartnerFromClientDomain).toHaveBeenCalledWith('app.abroad.finance')
    expect(partnerService.getPartnerFromApiKey).not.toHaveBeenCalled()
  })

  it('falls back to the referer host when origin is unavailable', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => {
        if (name === 'Referer') {
          return 'https://app.abroad.finance/swap?utm_source=minipay'
        }
        return undefined
      }) as unknown as Request['header'],
    })

    const result = await expressAuthentication(req, 'ApiKeyAuth')

    expect(result).toEqual({ ...partner, authenticationSource: 'CLIENT_DOMAIN' })
    expect(partnerService.getPartnerFromClientDomain).toHaveBeenCalledWith('app.abroad.finance')
  })

  it('authenticates with a bearer token', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer jwt-token' } })

    const result = await expressAuthentication(req, 'BearerAuth')

    expect(result).toEqual({ ...partner, authenticationSource: 'SEP_24' })
    expect(partnerService.authenticateBearerToken).toHaveBeenCalledWith('jwt-token')
  })

  it('bootstraps a portal session only from an explicit partner API key', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => {
        if (name === 'X-API-Key') return 'partner-key'
        if (name === 'Origin') return 'https://api-v3.production.decafapi.com'
        return undefined
      }) as unknown as Request['header'],
    })

    const result = await expressAuthentication(req, 'PartnerPortalBootstrapAuth')

    expect(result).toEqual({ ...partner, authenticationSource: 'API_KEY' })
    expect(partnerService.getPartnerFromApiKey).toHaveBeenCalledWith('partner-key')
    expect(partnerService.getPartnerFromClientDomain).not.toHaveBeenCalled()
  })

  it('does not let ambient Origin authentication bootstrap a portal session', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => (
        name === 'Origin' ? 'https://api-v3.production.decafapi.com' : undefined
      )) as unknown as Request['header'],
    })

    await expect(expressAuthentication(req, 'PartnerPortalBootstrapAuth')).rejects.toThrow(
      'Partner API key not provided',
    )
    expect(partnerService.getPartnerFromClientDomain).not.toHaveBeenCalled()
  })

  it('authenticates a purpose-specific partner portal token', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer portal-token' } })

    const result = await expressAuthentication(req, 'PartnerPortalAuth')

    expect(result).toEqual({ ...partner, authenticationSource: 'PARTNER_PORTAL' })
    expect(partnerPortalSessionService.verifySession).toHaveBeenCalledWith('portal-token')
    expect(partnerService.authenticateBearerToken).not.toHaveBeenCalled()
  })

  it('rejects an invalid partner portal token without falling back to other auth', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer invalid-portal-token' } })
    partnerPortalSessionService.verifySession.mockRejectedValueOnce(new Error('invalid'))

    await expect(expressAuthentication(req, 'PartnerPortalAuth')).rejects.toThrow(
      'Invalid partner portal token',
    )
    expect(partnerService.authenticateBearerToken).not.toHaveBeenCalled()
  })

  it('throws when the bearer token is missing', async () => {
    const req = buildRequest({ headers: {} })

    await expect(expressAuthentication(req, 'BearerAuth')).rejects.toThrow('No token provided')
    expect(partnerService.authenticateBearerToken).not.toHaveBeenCalled()
  })

  it('throws when the bearer token is invalid', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer bad-token' } })
    partnerService.authenticateBearerToken.mockRejectedValueOnce(new Error('invalid'))

    await expect(expressAuthentication(req, 'BearerAuth')).rejects.toThrow('Invalid token or partner not found')
  })

  it('does not let ambient client-domain auth race an explicit bearer token', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => (
        name === 'Origin' ? 'https://app.abroad.finance' : undefined
      )) as unknown as Request['header'],
      headers: { authorization: 'Bearer jwt-token' },
    })

    await expect(expressAuthentication(req, 'ApiKeyAuth')).rejects.toThrow(
      'Bearer token takes precedence over client domain',
    )
    expect(partnerService.getPartnerFromClientDomain).not.toHaveBeenCalled()
  })

  it('gives an explicit API key precedence over a bearer token', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => (
        name === 'X-API-Key' ? 'api-key-123' : undefined
      )) as unknown as Request['header'],
      headers: { authorization: 'Bearer jwt-token' },
    })

    await expect(expressAuthentication(req, 'BearerAuth')).rejects.toThrow(
      'API key takes precedence over Bearer token',
    )
    expect(partnerService.authenticateBearerToken).not.toHaveBeenCalled()
  })

  it('throws for unsupported security schemes', async () => {
    const req = buildRequest({ header: jest.fn() })

    await expect(expressAuthentication(req, 'UnknownAuth')).rejects.toThrow('Invalid security scheme')
  })
})
