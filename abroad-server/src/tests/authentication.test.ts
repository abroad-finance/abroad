import { Request } from 'express'

import type { IPartnerService } from '../modules/partners/application/contracts/IPartnerService'

import { iocContainer } from '../app/container'
import { expressAuthentication } from '../app/http/authentication'

const partnerService: jest.Mocked<IPartnerService> = {
  getPartnerFromApiKey: jest.fn(),
  getPartnerFromSepJwt: jest.fn(),
} as jest.Mocked<IPartnerService>

jest.mock('../app/container', () => ({
  iocContainer: {
    get: jest.fn(() => partnerService),
  },
}))

describe('expressAuthentication', () => {
  const partner = { id: 'p-1' } as unknown as import('@prisma/client').Partner

  beforeEach(() => {
    jest.clearAllMocks()
    partnerService.getPartnerFromApiKey.mockResolvedValue(partner)
    partnerService.getPartnerFromSepJwt.mockResolvedValue(partner)
    ;(iocContainer.get as jest.Mock).mockReturnValue(partnerService)
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

    expect(result).toBe(partner)
    expect(partnerService.getPartnerFromApiKey).toHaveBeenCalledWith('api-key-123')
  })

  it('throws when the API key is missing', async () => {
    const req = buildRequest({ header: jest.fn(() => undefined) as unknown as Request['header'] })

    await expect(expressAuthentication(req, 'ApiKeyAuth')).rejects.toThrow('API key not provided')
    expect(partnerService.getPartnerFromApiKey).not.toHaveBeenCalled()
  })

  it('authenticates with a bearer token', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer jwt-token' } })

    const result = await expressAuthentication(req, 'BearerAuth')

    expect(result).toBe(partner)
    expect(partnerService.getPartnerFromSepJwt).toHaveBeenCalledWith('jwt-token')
  })

  it('throws when the bearer token is missing', async () => {
    const req = buildRequest({ headers: {} })

    await expect(expressAuthentication(req, 'BearerAuth')).rejects.toThrow('No token provided')
    expect(partnerService.getPartnerFromSepJwt).not.toHaveBeenCalled()
  })

  it('throws when the bearer token is invalid', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer bad-token' } })
    partnerService.getPartnerFromSepJwt.mockRejectedValueOnce(new Error('invalid'))

    await expect(expressAuthentication(req, 'BearerAuth')).rejects.toThrow('Invalid token or partner not found')
  })

  it('throws for unsupported security schemes', async () => {
    const req = buildRequest({ header: jest.fn() })

    await expect(expressAuthentication(req, 'UnknownAuth')).rejects.toThrow('Invalid security scheme')
  })
})
