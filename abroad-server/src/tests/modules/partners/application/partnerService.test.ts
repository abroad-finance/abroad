import { sha512_224 } from 'js-sha512'
import jwt from 'jsonwebtoken'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { PartnerService } from '../../../../modules/partners/application/partnerService'

type PartnerModel = import('@prisma/client').Partner

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}))

describe('PartnerService', () => {
  const hashedApiKey = sha512_224('api-key')
  const hashedClientDomain = sha512_224('client.example.com')
  const partnerFromApiKey = { apiKey: hashedApiKey, clientDomainHash: null, id: 'partner-1' } as unknown as PartnerModel
  const partnerFromDomain = { apiKey: null, clientDomainHash: hashedClientDomain, id: 'partner-2' } as unknown as PartnerModel
  const defaultPartner = { clientDomainHash: null, id: 'secret-STELLAR_SEP_PARTNER_ID' } as unknown as PartnerModel

  let partnersByApiKey: Record<string, PartnerModel>
  let partnersByClientDomainHash: Record<string, PartnerModel>
  let partnersById: Record<string, PartnerModel>
  let dbProvider: IDatabaseClientProvider
  let secretManager: ISecretManager
  let service: PartnerService
  let findFirst: jest.Mock

  beforeEach(() => {
    partnersByApiKey = {
      [hashedApiKey]: partnerFromApiKey,
    }
    partnersByClientDomainHash = {
      [hashedClientDomain]: partnerFromDomain,
    }
    partnersById = {
      'secret-STELLAR_SEP_PARTNER_ID': defaultPartner,
    }
    findFirst = jest.fn(async ({ where }: { where?: { apiKey?: string, clientDomainHash?: string, id?: string } } = {}) => {
      if (where?.apiKey) {
        return partnersByApiKey[where.apiKey] ?? null
      }
      if (where?.clientDomainHash) {
        return partnersByClientDomainHash[where.clientDomainHash] ?? null
      }
      if (where?.id) {
        return partnersById[where.id] ?? null
      }
      return null
    })

    const prismaMock = {
      partner: {
        findFirst,
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
      iss: 'issuer',
      sub: 'subject',
    })
  })

  it('hashes and retrieves partner by API key', async () => {
    const result = await service.getPartnerFromApiKey('api-key')

    expect(dbProvider.getClient).toHaveBeenCalled()
    expect(findFirst).toHaveBeenCalledWith({ where: { apiKey: hashedApiKey } })
    expect(result).toBe(partnerFromApiKey)
  })

  it('throws when API key is missing or partner not found', async () => {
    await expect(service.getPartnerFromApiKey('')).rejects.toThrow('API key not provided')

    delete partnersByApiKey[hashedApiKey]
    await expect(service.getPartnerFromApiKey('api-key')).rejects.toThrow('Partner not found')
  })

  it('uses client_domain to resolve partner from SEP JWT', async () => {
    const result = await service.getPartnerFromSepJwt('token-123')

    expect(secretManager.getSecret).toHaveBeenCalledWith('STELLAR_SEP_JWT_SECRET')
    expect(secretManager.getSecret).toHaveBeenCalledWith('STELLAR_SEP_PARTNER_ID')
    expect(jwt.verify).toHaveBeenCalledWith('token-123', 'secret-STELLAR_SEP_JWT_SECRET')
    expect(findFirst).toHaveBeenCalledWith({ where: { clientDomainHash: hashedClientDomain } })
    expect(result).toBe(partnerFromDomain)
  })

  it('falls back to SEP partner when client_domain is missing', async () => {
    ;(jwt.verify as jest.Mock).mockReturnValueOnce({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'issuer',
      sub: 'subject',
    })

    const result = await service.getPartnerFromSepJwt('token-without-domain')

    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'secret-STELLAR_SEP_PARTNER_ID' } })
    expect(result).toBe(defaultPartner)
  })

  it('falls back to SEP partner when client_domain has no matching partner', async () => {
    delete partnersByClientDomainHash[hashedClientDomain]

    const result = await service.getPartnerFromSepJwt('token-no-partner')

    expect(findFirst).toHaveBeenCalledWith({ where: { clientDomainHash: hashedClientDomain } })
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'secret-STELLAR_SEP_PARTNER_ID' } })
    expect(result).toBe(defaultPartner)
  })

  it('throws when SEP verification fails or partner missing', async () => {
    ;(jwt.verify as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad')
    })
    await expect(service.getPartnerFromSepJwt('broken')).rejects.toThrow('SEP JWT verification failed')

    partnersById = {}
    ;(jwt.verify as jest.Mock).mockReturnValueOnce({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: 'issuer',
      sub: 'subject',
    })
    await expect(service.getPartnerFromSepJwt('token')).rejects.toThrow('SEP JWT verification failed')
  })
})
