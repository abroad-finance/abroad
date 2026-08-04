import { PartnerApiKeyScope } from '@prisma/client'
import { sha512_224 } from 'js-sha512'
import jwt from 'jsonwebtoken'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { PartnerService } from '../../../../modules/partners/application/partnerService'
import { parseClientDomain } from '../../../../modules/partners/domain/clientDomain'

type PartnerModel = import('@prisma/client').Partner

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}))

describe('PartnerService', () => {
  const hashedApiKey = sha512_224('api-key')
  const hashedClientDomain = sha512_224('client.example.com')
  const partnerFromApiKey = {
    apiKey: hashedApiKey,
    clientDomain: null,
    clientDomainHash: null,
    id: 'partner-1',
  } as unknown as PartnerModel
  const partnerFromPreviousApiKey = {
    apiKey: 'new-key-hash',
    clientDomain: null,
    clientDomainHash: null,
    id: 'partner-previous',
    previousApiKey: hashedApiKey,
    previousApiKeyExpiresAt: new Date(Date.now() + 60_000),
  } as unknown as PartnerModel
  const partnerFromDomain = {
    apiKey: null,
    clientDomain: 'client.example.com',
    clientDomainHash: hashedClientDomain,
    id: 'partner-2',
  } as unknown as PartnerModel
  const defaultPartner = {
    clientDomain: null,
    clientDomainHash: null,
    id: 'secret-STELLAR_SEP_PARTNER_ID',
  } as unknown as PartnerModel

  let partnersByApiKey: Record<string, PartnerModel>
  let partnersByPreviousApiKey: Record<string, PartnerModel>
  let partnersByClientDomainHash: Record<string, PartnerModel>
  let partnersById: Record<string, PartnerModel>
  let dbProvider: IDatabaseClientProvider
  let secretManager: ISecretManager
  let service: PartnerService
  let findFirst: jest.Mock
  let managedFindUnique: jest.Mock
  let managedUpdateMany: jest.Mock

  beforeEach(() => {
    partnersByApiKey = {
      [hashedApiKey]: partnerFromApiKey,
    }
    partnersByPreviousApiKey = {}
    partnersByClientDomainHash = {
      [hashedClientDomain]: partnerFromDomain,
    }
    partnersById = {
      'secret-STELLAR_SEP_PARTNER_ID': defaultPartner,
    }
    findFirst = jest.fn(async ({ where }: { where?: {
      apiKey?: string
      clientDomainHash?: string
      id?: string
      previousApiKey?: string
      previousApiKeyExpiresAt?: { gt: Date }
    } } = {}) => {
      if (where?.apiKey) {
        return partnersByApiKey[where.apiKey] ?? null
      }
      if (where?.clientDomainHash) {
        return partnersByClientDomainHash[where.clientDomainHash] ?? null
      }
      if (where?.id) {
        return partnersById[where.id] ?? null
      }
      if (where?.previousApiKey && where.previousApiKeyExpiresAt) {
        const partner = partnersByPreviousApiKey[where.previousApiKey] ?? null
        return partner?.previousApiKeyExpiresAt
          && partner.previousApiKeyExpiresAt > where.previousApiKeyExpiresAt.gt
          ? partner
          : null
      }
      return null
    })
    managedFindUnique = jest.fn(async () => null)
    managedUpdateMany = jest.fn(async () => ({ count: 1 }))

    const prismaMock = {
      partner: {
        findFirst,
      },
      partnerApiKey: {
        findUnique: managedFindUnique,
        updateMany: managedUpdateMany,
      },
    }
    dbProvider = {
      getClient: jest.fn(async () => prismaMock as unknown as import('@prisma/client').PrismaClient),
    }
    secretManager = {
      getSecret: jest.fn(async (name: string) => `secret-${name}`),
      getSecrets: jest.fn(),
    }
    service = new PartnerService(dbProvider, secretManager)
    ;(jwt.verify as jest.Mock).mockReset()
    ;(jwt.verify as jest.Mock).mockReturnValue({
      client_domain: 'client.example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://sep-stellar.abroad.finance/auth',
      jti: 'sep-challenge-hash',
      sub: 'subject',
    })
  })

  it('hashes and retrieves partner by API key', async () => {
    const result = await service.getPartnerFromApiKey('api-key')

    expect(dbProvider.getClient).toHaveBeenCalled()
    expect(findFirst).toHaveBeenCalledWith({ where: { apiKey: hashedApiKey } })
    expect(result).toBe(partnerFromApiKey)
  })

  it('accepts the previous legacy key only during the bounded rotation overlap', async () => {
    delete partnersByApiKey[hashedApiKey]
    partnersByPreviousApiKey[hashedApiKey] = partnerFromPreviousApiKey

    const result = await service.getPartnerFromApiKey('api-key')

    expect(findFirst).toHaveBeenNthCalledWith(1, { where: { apiKey: hashedApiKey } })
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        previousApiKey: hashedApiKey,
        previousApiKeyExpiresAt: { gt: expect.any(Date) },
      },
    })
    expect(result).toBe(partnerFromPreviousApiKey)
  })

  it('rejects an expired previous legacy key', async () => {
    delete partnersByApiKey[hashedApiKey]
    partnersByPreviousApiKey[hashedApiKey] = {
      ...partnerFromPreviousApiKey,
      previousApiKeyExpiresAt: new Date(Date.now() - 60_000),
    }

    await expect(service.getPartnerFromApiKey('api-key')).rejects.toThrow('Partner not found')
  })

  it('authenticates an active managed key with scopes and rate-limited usage metadata', async () => {
    managedFindUnique.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'managed-key-1',
      lastUsedAt: null,
      partner: partnerFromApiKey,
      revokedAt: null,
      scopes: [PartnerApiKeyScope.TRANSACTIONS_READ],
    })

    const result = await service.authenticateApiKey(' api-key ')

    expect(managedFindUnique).toHaveBeenCalledWith({
      include: { partner: true },
      where: { secretHash: hashedApiKey },
    })
    expect(result).toEqual({
      keyId: 'managed-key-1',
      kind: 'MANAGED',
      partner: partnerFromApiKey,
      scopes: ['transactions:read'],
    })
    expect(managedUpdateMany).toHaveBeenCalledWith({
      data: { lastUsedAt: expect.any(Date) },
      where: {
        id: 'managed-key-1',
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lte: expect.any(Date) } },
        ],
      },
    })
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('rejects revoked managed keys without falling back to the legacy key', async () => {
    managedFindUnique.mockResolvedValueOnce({
      expiresAt: null,
      id: 'managed-key-1',
      lastUsedAt: null,
      partner: partnerFromApiKey,
      revokedAt: new Date(),
      scopes: [PartnerApiKeyScope.TRANSACTIONS_READ],
    })

    await expect(service.authenticateApiKey('api-key')).rejects.toThrow('Partner not found')
    expect(findFirst).not.toHaveBeenCalled()
    expect(managedUpdateMany).not.toHaveBeenCalled()
  })

  it('does not rewrite recent managed-key last-used metadata', async () => {
    managedFindUnique.mockResolvedValueOnce({
      expiresAt: null,
      id: 'managed-key-1',
      lastUsedAt: new Date(),
      partner: partnerFromApiKey,
      revokedAt: null,
      scopes: [PartnerApiKeyScope.TRANSACTIONS_WRITE],
    })

    await service.authenticateApiKey('api-key')

    expect(managedUpdateMany).not.toHaveBeenCalled()
  })

  it('throws when API key is missing or partner not found', async () => {
    await expect(service.getPartnerFromApiKey('')).rejects.toThrow('API key not provided')

    delete partnersByApiKey[hashedApiKey]
    await expect(service.getPartnerFromApiKey('api-key')).rejects.toThrow('Partner not found')
  })

  it('retrieves a partner by normalized client domain', async () => {
    const clientDomain = parseClientDomain('Client.Example.com')

    expect(clientDomain).not.toBeNull()
    if (!clientDomain) {
      throw new Error('Expected valid client domain')
    }

    const result = await service.getPartnerFromClientDomain(clientDomain)

    expect(findFirst).toHaveBeenCalledWith({ where: { clientDomainHash: hashedClientDomain } })
    expect(result).toBe(partnerFromDomain)
  })

  it('uses client_domain to resolve partner from SEP JWT', async () => {
    const result = await service.authenticateBearerToken('token-123')

    expect(secretManager.getSecret).toHaveBeenCalledWith('STELLAR_SEP_JWT_SECRET')
    expect(secretManager.getSecret).toHaveBeenCalledWith('STELLAR_SEP_PARTNER_ID')
    expect(jwt.verify).toHaveBeenCalledWith('token-123', 'secret-STELLAR_SEP_JWT_SECRET')
    expect(findFirst).toHaveBeenCalledWith({ where: { clientDomainHash: hashedClientDomain } })
    expect(result).toEqual({
      authenticatedSubject: 'subject',
      partner: partnerFromDomain,
      source: 'SEP_24',
    })
  })

  it('falls back to SEP partner when client_domain is missing', async () => {
    ;(jwt.verify as jest.Mock).mockReturnValueOnce({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://sep-stellar.abroad.finance/auth',
      jti: 'sep-challenge-hash',
      sub: 'subject',
    })

    const result = await service.authenticateBearerToken('token-without-domain')

    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'secret-STELLAR_SEP_PARTNER_ID' } })
    expect(result).toEqual({
      authenticatedSubject: 'subject',
      partner: defaultPartner,
      source: 'SEP_24',
    })
  })

  it('falls back to SEP partner when client_domain has no matching partner', async () => {
    delete partnersByClientDomainHash[hashedClientDomain]

    const result = await service.authenticateBearerToken('token-no-partner')

    expect(findFirst).toHaveBeenCalledWith({ where: { clientDomainHash: hashedClientDomain } })
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'secret-STELLAR_SEP_PARTNER_ID' } })
    expect(result).toEqual({
      authenticatedSubject: 'subject',
      partner: defaultPartner,
      source: 'SEP_24',
    })
  })

  it('throws when SEP verification fails or partner missing', async () => {
    ;(jwt.verify as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad')
    })
    await expect(service.authenticateBearerToken('broken')).rejects.toThrow('Bearer JWT verification failed')

    partnersById = {}
    ;(jwt.verify as jest.Mock).mockReturnValueOnce({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://sep-stellar.abroad.finance/auth',
      jti: 'sep-challenge-hash',
      sub: 'subject',
    })
    await expect(service.authenticateBearerToken('token')).rejects.toThrow('Bearer JWT verification failed')
  })

  it('classifies Abroad wallet tokens as direct wallet authentication', async () => {
    ;(jwt.verify as jest.Mock).mockReturnValueOnce({
      exp: Math.floor(Date.now() / 1000) + 3600,
      signers: ['GABC'],
      sub: 'stellar:pubnet:GABC',
    })

    const result = await service.authenticateBearerToken('wallet-token')

    expect(result).toEqual({
      authenticatedSubject: 'stellar:pubnet:GABC',
      partner: defaultPartner,
      source: 'WALLET',
    })
  })

  it('does not trust malformed SEP issuer claims as SEP provenance', async () => {
    ;(jwt.verify as jest.Mock).mockReturnValueOnce({
      iss: 'not-a-url',
      jti: 'claim-id',
      sub: 'subject',
    })

    const result = await service.authenticateBearerToken('ambiguous-token')

    expect(result.authenticatedSubject).toBe('subject')
    expect(result.source).toBe('WALLET')
  })
})
