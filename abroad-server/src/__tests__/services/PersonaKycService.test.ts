import { KycStatus, KYCTier } from '@prisma/client'
import axios from 'axios'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { ISecretManager, Secret } from '../../interfaces/ISecretManager'

import { getNextTier, PersonaKycService } from '../../services/PersonaKycService'

jest.mock('axios')

const mockedAxios = axios as jest.Mocked<typeof axios>

class SecretManagerStub implements ISecretManager {
  constructor(private readonly secrets: Partial<Record<Secret, string>> = {}) { }

  async getSecret(name: Secret): Promise<string> {
    const value = this.secrets[name]
    if (!value) throw new Error(`Missing secret: ${name}`)
    return value
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    return secretNames.reduce<Record<T[number], string>>((acc, name) => {
      const key = name as T[number]
      const value = this.secrets[key]
      if (!value) throw new Error(`Missing secret: ${key}`)
      acc[key] = value
      return acc
    }, {} as Record<T[number], string>)
  }
}

describe('PersonaKycService.getKycLink', () => {
  const createSpy = jest.fn()
  const findFirstSpy = jest.fn()
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      partnerUserKyc: {
        create: createSpy,
        findFirst: findFirstSpy,
      },
    } as unknown as import('@prisma/client').PrismaClient)),
  }

  const secretManager = new SecretManagerStub({
    PERSONA_API_KEY: 'persona-api-key',
  })

  beforeEach(() => {
    jest.clearAllMocks()
    createSpy.mockReset()
    findFirstSpy.mockReset()
  })

  it('returns null when user already satisfies KYC tier', async () => {
    findFirstSpy.mockResolvedValue({ status: KycStatus.APPROVED, tier: KYCTier.ENHANCED })
    const service = new PersonaKycService(dbProvider, secretManager)

    const result = await service.getKycLink({
      amount: 100,
      country: 'CO',
      redirectUrl: undefined,
      userId: 'user-1',
    })

    expect(result).toBeNull()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('creates a new inquiry and persists the pending KYC record', async () => {
    findFirstSpy.mockResolvedValue(null)
    mockedAxios.post.mockResolvedValue({
      data: { data: { id: 'inquiry-1' } },
    })
    const service = new PersonaKycService(dbProvider, secretManager)

    const link = await service.getKycLink({
      amount: 10_000,
      country: 'CO',
      redirectUrl: 'https://app.test/callback',
      userId: 'user-2',
    })

    expect(link).toContain('https://withpersona.com/verify?')
    expect(link).toContain('redirect-uri=https%3A%2F%2Fapp.test%2Fcallback')
    expect(createSpy).toHaveBeenCalledWith({
      data: {
        externalId: 'inquiry-1',
        link,
        partnerUserId: 'user-2',
        status: KycStatus.PENDING,
        tier: KYCTier.ENHANCED,
      },
    })
  })

  it('throws when Persona does not return an inquiry id', async () => {
    findFirstSpy.mockResolvedValue(null)
    mockedAxios.post.mockResolvedValue({
      data: { data: { id: undefined } },
    })
    const service = new PersonaKycService(dbProvider, secretManager)

    await expect(service.getKycLink({
      amount: 50,
      country: 'CO',
      redirectUrl: undefined,
      userId: 'user-3',
    })).rejects.toThrow('Failed to create Persona inquiry – missing id')
  })
})

describe('PersonaKycService.getNextTier', () => {
  it('throws for negative amounts', () => {
    expect(() => getNextTier('CO', -1)).toThrow('Amount cannot be negative')
  })

  it('returns null when existing tier meets the requirement', () => {
    expect(getNextTier('CO', 500, KYCTier.ENHANCED)).toBeNull()
  })

  it('promotes BR users above the BASIC threshold', () => {
    expect(getNextTier('BR', 2_000, KYCTier.NONE)).toBe(KYCTier.ENHANCED)
  })

  it('requires BASIC for small CO transactions', () => {
    expect(getNextTier('CO', 100, KYCTier.NONE)).toBe(KYCTier.BASIC)
  })
})
