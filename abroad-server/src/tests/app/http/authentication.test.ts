import { Request } from 'express'

import type { IPartnerService } from '../../../modules/partners/application/contracts/IPartnerService'

import { iocContainer } from '../../../app/container'
import { TYPES } from '../../../app/container/types'
import { expressAuthentication } from '../../../app/http/authentication'
import { OpsAuthService } from '../../../app/http/OpsAuthService'
import { OpsIdentityService } from '../../../modules/operations/application/OpsIdentityService'
import { PartnerPortalSessionService } from '../../../modules/partners/application/PartnerPortalSessionService'

const partnerService: jest.Mocked<IPartnerService> = {
  authenticateApiKey: jest.fn(),
  authenticateBearerToken: jest.fn(),
  getPartnerFromApiKey: jest.fn(),
  getPartnerFromClientDomain: jest.fn(),
} as jest.Mocked<IPartnerService>

const partnerPortalSessionService = {
  verifySession: jest.fn(),
}

const opsIdentityProvider = {
  verifyIdToken: jest.fn(),
}

const opsIdentityService = {
  authenticate: jest.fn(),
}

const opsAuthService = {
  authenticateLegacyApiKey: jest.fn(),
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
    partnerService.authenticateApiKey.mockResolvedValue({ kind: 'LEGACY', partner })
    partnerService.getPartnerFromApiKey.mockResolvedValue(partner)
    partnerService.getPartnerFromClientDomain.mockResolvedValue(partner)
    partnerPortalSessionService.verifySession.mockResolvedValue({
      authenticationSource: 'PARTNER_PORTAL',
      email: 'admin@decaf.so',
      kind: 'partner_portal',
      mfaEnabled: true,
      mfaVerified: true,
      partner,
      role: 'ADMIN',
      userId: 'portal-user-1',
    })
    opsIdentityProvider.verifyIdToken.mockResolvedValue({
      authTime: new Date('2026-08-02T15:00:00.000Z'),
      displayName: 'Ops User',
      email: 'ops@abroad.finance',
      provider: 'google.com',
      subject: 'firebase-subject-1',
    })
    opsIdentityService.authenticate.mockResolvedValue({
      authTime: new Date('2026-08-02T15:00:00.000Z'),
      displayName: 'Ops User',
      email: 'ops@abroad.finance',
      kind: 'ops_user',
      permissions: ['overview:read', 'transactions:read'],
      role: 'OPERATIONS',
      sessionVersion: 1,
      userId: 'ops-user-1',
    })
    opsAuthService.authenticateLegacyApiKey.mockResolvedValue({
      authTime: null,
      displayName: 'Legacy Ops key',
      email: null,
      kind: 'ops_legacy',
      permissions: ['overview:read'],
      role: null,
      sessionVersion: null,
      userId: null,
    })
    ;(iocContainer.get as jest.Mock).mockImplementation((identifier) => {
      if (identifier === PartnerPortalSessionService) {
        return partnerPortalSessionService
      }
      if (identifier === TYPES.IOpsIdentityProvider) {
        return opsIdentityProvider
      }
      if (identifier === OpsIdentityService) {
        return opsIdentityService
      }
      if (identifier === TYPES.IOpsAuthService || identifier === OpsAuthService) {
        return opsAuthService
      }
      return partnerService
    })
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
    expect(partnerService.authenticateApiKey).toHaveBeenCalledWith('api-key-123')
  })

  it('enforces managed API-key scopes and preserves legacy full-scope access', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => (name === 'X-API-Key' ? 'api-key-123' : undefined)) as unknown as Request['header'],
    })
    partnerService.authenticateApiKey.mockResolvedValueOnce({
      keyId: 'managed-key-1',
      kind: 'MANAGED',
      partner,
      scopes: ['transactions:read'],
    })

    await expect(expressAuthentication(
      req,
      'ApiKeyAuth',
      ['transactions:write'],
    )).rejects.toThrow('API key does not include a required scope')

    partnerService.authenticateApiKey.mockResolvedValueOnce({ kind: 'LEGACY', partner })
    await expect(expressAuthentication(
      req,
      'ApiKeyAuth',
      ['transactions:write'],
    )).resolves.toEqual({ ...partner, authenticationSource: 'API_KEY' })
  })

  it('throws when the API key is missing', async () => {
    const req = buildRequest({ header: jest.fn(() => undefined) as unknown as Request['header'] })

    await expect(expressAuthentication(req, 'ApiKeyAuth')).rejects.toThrow('API key not provided')
    expect(partnerService.authenticateApiKey).not.toHaveBeenCalled()
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
    expect(partnerService.authenticateApiKey).not.toHaveBeenCalled()
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

  it('authenticates a purpose-specific partner portal token', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer portal-token' } })

    const result = await expressAuthentication(req, 'PartnerPortalAuth')

    expect(result).toEqual(expect.objectContaining({
      kind: 'partner_portal',
      partner,
      role: 'ADMIN',
      userId: 'portal-user-1',
    }))
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

  it('enforces portal administrator and verified-MFA route scopes', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer portal-token' } })
    partnerPortalSessionService.verifySession.mockResolvedValueOnce({
      authenticationSource: 'PARTNER_PORTAL',
      email: 'member@decaf.so',
      kind: 'partner_portal',
      mfaEnabled: true,
      mfaVerified: true,
      partner,
      role: 'MEMBER',
      userId: 'member-1',
    })

    await expect(expressAuthentication(
      req,
      'PartnerPortalAuth',
      ['admin'],
    )).rejects.toThrow('Invalid partner portal token')

    partnerPortalSessionService.verifySession.mockResolvedValueOnce({
      authenticationSource: 'PARTNER_PORTAL',
      email: 'admin@decaf.so',
      kind: 'partner_portal',
      mfaEnabled: true,
      mfaVerified: false,
      partner,
      role: 'ADMIN',
      userId: 'admin-1',
    })
    await expect(expressAuthentication(
      req,
      'PartnerPortalAuth',
      ['admin', 'mfa'],
    )).rejects.toThrow('Invalid partner portal token')
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

  it('verifies a Firebase identity for the Ops admission boundary', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer firebase-token' } })

    const result = await expressAuthentication(req, 'OpsFirebaseAuth')

    expect(result).toEqual(expect.objectContaining({
      email: 'ops@abroad.finance',
      kind: 'ops_external',
      subject: 'firebase-subject-1',
    }))
    expect(opsIdentityProvider.verifyIdToken).toHaveBeenCalledWith('firebase-token')
  })

  it('authenticates a named Ops session and enforces permission scopes', async () => {
    const req = buildRequest({ headers: { authorization: 'Bearer firebase-token' } })

    await expect(expressAuthentication(
      req,
      'OpsAuth',
      ['transactions:read'],
    )).resolves.toEqual(expect.objectContaining({
      kind: 'ops_user',
      userId: 'ops-user-1',
    }))
    expect(opsIdentityService.authenticate).toHaveBeenCalledWith('firebase-token')

    await expect(expressAuthentication(
      req,
      'OpsAuth',
      ['kyc:reveal'],
    )).rejects.toThrow('You do not have permission')
  })

  it('uses the bounded legacy Ops key fallback when no bearer token is present', async () => {
    const req = buildRequest({
      header: jest.fn((name: string) => (
        name === 'X-OPS-API-KEY' ? 'legacy-key' : undefined
      )) as unknown as Request['header'],
    })

    await expect(expressAuthentication(
      req,
      'OpsAuth',
      ['overview:read'],
    )).resolves.toEqual(expect.objectContaining({ kind: 'ops_legacy' }))
    expect(opsAuthService.authenticateLegacyApiKey).toHaveBeenCalledWith('legacy-key')
  })

  it('rejects absent Ops Firebase credentials and unknown permission scopes', async () => {
    const req = buildRequest({ headers: {} })

    await expect(expressAuthentication(req, 'OpsFirebaseAuth')).rejects.toThrow(
      'Ops identity token not provided',
    )

    const bearerRequest = buildRequest({
      headers: { authorization: 'Bearer firebase-token' },
    })
    await expect(expressAuthentication(
      bearerRequest,
      'OpsAuth',
      ['not-a-real-permission'],
    )).rejects.toThrow('You do not have permission')
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
