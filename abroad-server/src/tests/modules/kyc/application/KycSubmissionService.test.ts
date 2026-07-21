import 'reflect-metadata'
import { DocumentType, KycStatus } from '@prisma/client'

import type { IKycDocumentStorage } from '../../../../modules/kyc/application/contracts/IKycDocumentStorage'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { KycSubmissionInput, KycSubmissionService } from '../../../../modules/kyc/application/KycSubmissionService'
import { DisabledUserError } from '../../../../modules/shared/partnerUserAccess'

const buildInput = (overrides?: Partial<KycSubmissionInput>): KycSubmissionInput => ({
  address: '742 Evergreen Terrace',
  city: 'Springfield',
  dateOfBirth: new Date('1990-01-01T00:00:00Z'),
  document: {
    buffer: Buffer.from('fake-image-bytes'),
    contentType: 'image/jpeg',
    fileExtension: 'jpg',
  },
  documentNumber: 'ABC123',
  documentType: DocumentType.NATIONAL_ID,
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  nationality: 'CO',
  partnerId: 'partner-1',
  phone: '+5712345678',
  userId: 'user-1',
  ...overrides,
})

const buildHarness = (opts?: {
  disabledAt?: Date | null
  existingKyc?: { id: string } | null
}) => {
  const prisma = {
    partnerUser: {
      upsert: jest.fn().mockResolvedValue({
        disabledAt: opts?.disabledAt ?? null,
        id: 'pu-1',
        partnerId: 'partner-1',
        userId: 'user-1',
      }),
    },
    partnerUserKyc: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'kyc-new' })),
      findFirst: jest.fn().mockResolvedValue(opts?.existingKyc ?? null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'kyc-existing' })),
    },
  }

  const documentStorage = {
    download: jest.fn(),
    upload: jest.fn(async () => 'kyc-documents/pu-1/id.jpg'),
  }

  const service = new KycSubmissionService(
    { getClient: jest.fn(async () => prisma) } as unknown as IDatabaseClientProvider,
    documentStorage as unknown as IKycDocumentStorage,
  )

  return { documentStorage, prisma, service }
}

describe('KycSubmissionService', () => {
  it('uploads the document and writes an auto-approved KYC record for a complete submission', async () => {
    const { documentStorage, prisma, service } = buildHarness()

    const result = await service.submit(buildInput())

    expect(prisma.partnerUser.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { partnerId: 'partner-1', userId: 'user-1' },
      where: { partnerId_userId: { partnerId: 'partner-1', userId: 'user-1' } },
    }))
    expect(documentStorage.upload).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
      contentType: 'image/jpeg',
      fileExtension: 'jpg',
      partnerUserId: 'pu-1',
    })
    expect(prisma.partnerUserKyc.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        address: '742 Evergreen Terrace',
        city: 'Springfield',
        documentImagePath: 'kyc-documents/pu-1/id.jpg',
        documentNumber: 'ABC123',
        documentType: DocumentType.NATIONAL_ID,
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        nationality: 'CO',
        partnerUserId: 'pu-1',
        phone: '+5712345678',
        reviewedAt: expect.any(Date),
        status: KycStatus.APPROVED,
      }),
    })
    expect(prisma.partnerUserKyc.update).not.toHaveBeenCalled()
    expect(result).toEqual({ status: KycStatus.APPROVED })
  })

  it('refreshes the existing current KYC row instead of creating a new one', async () => {
    const { documentStorage, prisma, service } = buildHarness({ existingKyc: { id: 'kyc-existing' } })

    const result = await service.submit(buildInput())

    expect(documentStorage.upload).toHaveBeenCalled()
    expect(prisma.partnerUserKyc.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentImagePath: 'kyc-documents/pu-1/id.jpg',
        reviewedAt: expect.any(Date),
        status: KycStatus.APPROVED,
      }),
      where: { id: 'kyc-existing' },
    })
    expect(prisma.partnerUserKyc.create).not.toHaveBeenCalled()
    expect(result).toEqual({ status: KycStatus.APPROVED })
  })

  it('throws DisabledUserError and skips the upload when the resolved user is disabled', async () => {
    const { documentStorage, prisma, service } = buildHarness({ disabledAt: new Date('2026-01-01T00:00:00Z') })

    await expect(service.submit(buildInput())).rejects.toThrow(DisabledUserError)

    expect(documentStorage.upload).not.toHaveBeenCalled()
    expect(prisma.partnerUserKyc.create).not.toHaveBeenCalled()
    expect(prisma.partnerUserKyc.update).not.toHaveBeenCalled()
  })
})
