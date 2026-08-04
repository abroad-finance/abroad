import 'reflect-metadata'
import { KycStatus } from '@prisma/client'

import type { KycSubmissionService } from '../../../../../modules/kyc/application/KycSubmissionService'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { KycController } from '../../../../../modules/kyc/interfaces/http/KycController'

const walletSubject = 'stellar:pubnet:GOWNER'

const walletRequest = {
  user: {
    authenticatedSubject: walletSubject,
    authenticationSource: 'WALLET',
    id: 'partner-1',
  },
} as unknown as import('express').Request

const apiKeyRequest = {
  user: {
    authenticationSource: 'API_KEY',
    id: 'partner-1',
  },
} as unknown as import('express').Request

const document = {
  buffer: Buffer.from('document-bytes'),
  encoding: '7bit',
  fieldname: 'document',
  mimetype: 'application/pdf',
  originalname: 'document.pdf',
  size: 14,
} as Express.Multer.File

const buildHarness = () => {
  const prisma = {
    partnerUser: {
      findUnique: jest.fn().mockResolvedValue({ id: 'partner-user-1' }),
    },
    partnerUserKyc: {
      findFirst: jest.fn().mockResolvedValue({ status: KycStatus.APPROVED }),
    },
  }
  const submissionService = {
    submit: jest.fn().mockResolvedValue({ status: KycStatus.APPROVED }),
  }
  const controller = new KycController(
    submissionService as unknown as KycSubmissionService,
    { getClient: jest.fn().mockResolvedValue(prisma) } as unknown as IDatabaseClientProvider,
  )
  return { controller, prisma, submissionService }
}

const submit = (
  controller: KycController,
  request: import('express').Request,
  userId: string,
) => controller.submitKyc(
  request,
  document,
  userId,
  'Ada Lovelace',
  'PASSPORT',
  'P123456',
  '1990-01-01',
  'BR',
  'Rio de Janeiro',
  'Avenida Atlântica 100',
  'ada@example.com',
  '+5521999999999',
)

describe('KycController wallet ownership', () => {
  it('derives status ownership from the verified wallet subject', async () => {
    const { controller, prisma } = buildHarness()

    const result = await controller.getKycStatus(walletRequest, 'stellar:pubnet:GOTHER')

    expect(prisma.partnerUser.findUnique).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        partnerId_userId: {
          partnerId: 'partner-1',
          userId: walletSubject,
        },
      },
    })
    expect(result).toEqual({ hasApproved: true, status: KycStatus.APPROVED })
  })

  it('submits KYC only for the verified wallet subject', async () => {
    const { controller, submissionService } = buildHarness()

    await submit(controller, walletRequest, 'stellar:pubnet:GOTHER')

    expect(submissionService.submit).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: 'partner-1',
      userId: walletSubject,
    }))
  })

  it('preserves the explicit user id for partner API-key callers', async () => {
    const { controller, submissionService } = buildHarness()

    await submit(controller, apiKeyRequest, 'partner-customer-42')

    expect(submissionService.submit).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: 'partner-1',
      userId: 'partner-customer-42',
    }))
  })
})
