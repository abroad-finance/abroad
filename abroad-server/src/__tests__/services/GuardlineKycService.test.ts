import 'reflect-metadata'
import { KycStatus, KYCTier } from '@prisma/client'
import axios from 'axios'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { ISecretManager } from '../../interfaces/ISecretManager'

import { GuardLineKycService } from '../../services/GuardlineKycService'

jest.mock('axios')
jest.mock('../../constants/workflowRules', () => ({
  getNextTier: jest.fn(),
  workflowByTier: { CO: { [KYCTier.BASIC]: 'workflow-1' } },
}))

const mockedAxios = axios as unknown as jest.MockedFunction<typeof axios> & { post: jest.Mock }
const { getNextTier } = jest.requireMock('../../constants/workflowRules') as { getNextTier: jest.Mock }

type PrismaLike = {
  partnerUserKyc: {
    create: jest.Mock
    findFirst: jest.Mock
  }
}

const buildService = () => {
  const prisma: PrismaLike = {
    partnerUserKyc: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  } as unknown as IDatabaseClientProvider
  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => 'tenant-1'),
    getSecrets: jest.fn(),
  }

  const service = new GuardLineKycService(dbProvider, secretManager)
  return { dbProvider, prisma, secretManager, service }
}

describe('GuardLineKycService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedAxios.mockReset()
    mockedAxios.post = jest.fn()
  })

  it('returns null when no next tier is available', async () => {
    const { prisma, service } = buildService()
    getNextTier.mockReturnValueOnce(null)

    const link = await service.getKycLink({
      amount: 100,
      country: 'CO',
      redirectUrl: undefined,
      userId: 'user-1',
    })

    expect(link).toBeNull()
    expect(prisma.partnerUserKyc.create).not.toHaveBeenCalled()
  })

  it('creates a Guardline session and returns the KYC link', async () => {
    const { prisma, secretManager, service } = buildService()
    getNextTier.mockReturnValueOnce(KYCTier.BASIC)
    prisma.partnerUserKyc.findFirst.mockResolvedValueOnce({
      id: 'existing-kyc',
      partnerUserId: 'user-2',
      status: KycStatus.APPROVED,
      tier: KYCTier.BASIC,
    })
    mockedAxios.post.mockResolvedValueOnce({
      data: { first_step_name: 'step-1', workflow_instance_id: 'inst-1' },
    })

    const link = await service.getKycLink({
      amount: 200,
      country: 'CO',
      redirectUrl: 'https://app.example.com/return',
      userId: 'user-2',
    })

    expect(link).toBe('https://onboarding.guardline.io/tenant-1/inst-1/step-1?redirect_uri=https://app.example.com/return')
    expect(secretManager.getSecret).toHaveBeenCalledWith('GUARDLINE_TENANT_ID')
    expect(prisma.partnerUserKyc.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalId: 'inst-1',
        partnerUserId: 'user-2',
        status: KycStatus.PENDING,
        tier: KYCTier.BASIC,
      }),
    }))
  })

  it('maps Guardline statuses to internal KYC statuses', () => {
    const { service } = buildService()
    const mapper = service as unknown as { mapStatus: (status: string) => KycStatus }
    expect(mapper.mapStatus('CANCELED')).toBe(KycStatus.REJECTED)
    expect(mapper.mapStatus('COMPLETED_FAILURE')).toBe(KycStatus.REJECTED)
    expect(mapper.mapStatus('COMPLETED_SUCCESS')).toBe(KycStatus.APPROVED)
    expect(mapper.mapStatus('INCOMPLETE')).toBe(KycStatus.PENDING_APPROVAL)
    expect(mapper.mapStatus('UNKNOWN')).toBe(KycStatus.PENDING_APPROVAL)
  })
})
