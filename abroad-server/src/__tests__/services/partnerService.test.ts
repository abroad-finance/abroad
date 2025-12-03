import jwt from 'jsonwebtoken'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { ISecretManager } from '../../interfaces/ISecretManager'

import { PartnerService } from '../../services/partnerService'

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}))

describe('PartnerService', () => {
  const partner = { apiKey: 'hash', id: 'partner-1' }
  let dbProvider: IDatabaseClientProvider
  let secretManager: ISecretManager
  let service: PartnerService

  beforeEach(() => {
    const prismaMock = {
      partner: {
        findFirst: jest.fn(async () => partner),
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
    ;(jwt.verify as jest.Mock).mockClear()
  })

  it('hashes and retrieves partner by API key', async () => {
    const result = await service.getPartnerFromApiKey('api-key')

    expect(dbProvider.getClient).toHaveBeenCalled()
    expect(result).toBe(partner)
  })

  it('throws when API key is missing or partner not found', async () => {
    await expect(service.getPartnerFromApiKey('')).rejects.toThrow('API key not provided')

    const prisma = await dbProvider.getClient() as unknown as { partner: { findFirst: jest.Mock } }
    prisma.partner.findFirst.mockResolvedValueOnce(null)
    await expect(service.getPartnerFromApiKey('some-key')).rejects.toThrow('Partner not found')
  })

  it('verifies SEP JWT and returns partner', async () => {
    const result = await service.getPartnerFromSepJwt('token-123')

    expect(secretManager.getSecret).toHaveBeenCalledWith('STELLAR_SEP_JWT_SECRET')
    expect(secretManager.getSecret).toHaveBeenCalledWith('STELLAR_SEP_PARTNER_ID')
    expect(jwt.verify).toHaveBeenCalledWith('token-123', 'secret-STELLAR_SEP_JWT_SECRET')
    expect(result).toBe(partner)
  })

  it('throws when SEP verification fails or partner missing', async () => {
    ;(jwt.verify as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad')
    })
    await expect(service.getPartnerFromSepJwt('broken')).rejects.toThrow('SEP JWT verification failed')

    const prisma = await dbProvider.getClient() as unknown as { partner: { findFirst: jest.Mock } }
    prisma.partner.findFirst.mockResolvedValueOnce(null)
    ;(jwt.verify as jest.Mock).mockImplementation(() => undefined)
    await expect(service.getPartnerFromSepJwt('token')).rejects.toThrow('SEP JWT verification failed')
  })
})
