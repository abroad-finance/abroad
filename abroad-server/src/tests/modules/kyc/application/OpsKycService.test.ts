import 'reflect-metadata'
import { DocumentType, KycStatus, Prisma } from '@prisma/client'

import type { IKycDocumentStorage } from '../../../../modules/kyc/application/contracts/IKycDocumentStorage'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { NotFoundError } from '../../../../core/errors'
import { OpsKycService } from '../../../../modules/kyc/application/OpsKycService'

const notFoundPrismaError = () =>
  new Prisma.PrismaClientKnownRequestError('missing', { clientVersion: '1.0', code: 'P2025' })

const buildKycRecord = (overrides?: Record<string, unknown>) => ({
  address: '742 Evergreen Terrace',
  city: 'Springfield',
  createdAt: new Date('2024-05-01T00:00:00Z'),
  dateOfBirth: new Date('1990-01-01T00:00:00Z'),
  documentImagePath: 'kyc-documents/pu-1/id.jpg',
  documentNumber: 'ABC123',
  documentType: DocumentType.NATIONAL_ID,
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  id: 'kyc-1',
  nationality: 'CO',
  partnerUser: {
    disabledAt: null,
    partner: { name: 'Acme Inc' },
    partnerId: 'partner-1',
    userId: 'user-1',
  },
  partnerUserId: 'pu-1',
  phone: '+5712345678',
  reviewedAt: new Date('2024-05-02T00:00:00Z'),
  status: KycStatus.APPROVED,
  ...overrides,
})

const buildHarness = () => {
  const prisma = {
    partnerUser: {
      update: jest.fn(),
    },
    partnerUserKyc: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  }

  const documentStorage = {
    download: jest.fn(),
    upload: jest.fn(),
  }

  const service = new OpsKycService(
    { getClient: jest.fn(async () => prisma) } as unknown as IDatabaseClientProvider,
    documentStorage as unknown as IKycDocumentStorage,
  )

  return { documentStorage, prisma, service }
}

describe('OpsKycService', () => {
  describe('listSubmissions', () => {
    it('returns a paginated shape and only rows carrying a stored document', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findMany.mockResolvedValue([buildKycRecord()])
      prisma.partnerUserKyc.count.mockResolvedValue(1)

      const result = await service.listSubmissions({ page: 2, pageSize: 10 })

      expect(prisma.partnerUserKyc.findMany).toHaveBeenCalledWith(expect.objectContaining({
        skip: 10,
        take: 10,
        where: { documentImagePath: { not: null } },
      }))
      expect(result).toMatchObject({ page: 2, pageSize: 10, total: 1 })
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        hasDocument: true,
        id: 'kyc-1',
        partnerId: 'partner-1',
        partnerName: 'Acme Inc',
        partnerUserId: 'pu-1',
        status: KycStatus.APPROVED,
        submittedAt: new Date('2024-05-01T00:00:00Z'),
        userId: 'user-1',
      })
    })

    it('narrows the query by status when provided', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findMany.mockResolvedValue([])
      prisma.partnerUserKyc.count.mockResolvedValue(0)

      await service.listSubmissions({ page: 1, pageSize: 25, status: KycStatus.REJECTED })

      expect(prisma.partnerUserKyc.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { documentImagePath: { not: null }, status: KycStatus.REJECTED },
      }))
    })
  })

  describe('disableUser', () => {
    it('sets disabledAt and returns the new user state', async () => {
      const { prisma, service } = buildHarness()
      const disabledAt = new Date('2026-02-01T00:00:00Z')
      prisma.partnerUser.update.mockResolvedValue({ disabledAt, id: 'pu-1' })

      const result = await service.disableUser({ disabledBy: 'ops@abroad.io', partnerUserId: 'pu-1', reason: 'fraud' })

      expect(prisma.partnerUser.update).toHaveBeenCalledWith(expect.objectContaining({
        data: {
          disabledAt: expect.any(Date),
          disabledBy: 'ops@abroad.io',
          disabledReason: 'fraud',
        },
        where: { id: 'pu-1' },
      }))
      expect(result).toEqual({ disabledAt, partnerUserId: 'pu-1' })
    })

    it('maps a Prisma P2025 error to NotFoundError', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUser.update.mockRejectedValue(notFoundPrismaError())

      await expect(service.disableUser({ partnerUserId: 'missing' })).rejects.toThrow(NotFoundError)
    })
  })

  describe('enableUser', () => {
    it('clears the disable columns', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUser.update.mockResolvedValue({ disabledAt: null, id: 'pu-1' })

      const result = await service.enableUser('pu-1')

      expect(prisma.partnerUser.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { disabledAt: null, disabledBy: null, disabledReason: null },
        where: { id: 'pu-1' },
      }))
      expect(result).toEqual({ disabledAt: null, partnerUserId: 'pu-1' })
    })

    it('maps a Prisma P2025 error to NotFoundError', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUser.update.mockRejectedValue(notFoundPrismaError())

      await expect(service.enableUser('missing')).rejects.toThrow(NotFoundError)
    })
  })

  describe('getDocument', () => {
    it('throws NotFoundError when the KYC row is missing', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findUnique.mockResolvedValue(null)

      await expect(service.getDocument('kyc-1')).rejects.toThrow(NotFoundError)
    })

    it('throws NotFoundError when the row has no stored image', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findUnique.mockResolvedValue({ documentImagePath: null })

      await expect(service.getDocument('kyc-1')).rejects.toThrow(NotFoundError)
    })

    it('returns the storage download for a stored image', async () => {
      const { documentStorage, prisma, service } = buildHarness()
      const download = { buffer: Buffer.from('image-bytes'), contentType: 'image/jpeg' }
      prisma.partnerUserKyc.findUnique.mockResolvedValue({ documentImagePath: 'kyc-documents/pu-1/id.jpg' })
      documentStorage.download.mockResolvedValue(download)

      const result = await service.getDocument('kyc-1')

      expect(documentStorage.download).toHaveBeenCalledWith('kyc-documents/pu-1/id.jpg')
      expect(result).toBe(download)
    })
  })

  describe('rejectKyc', () => {
    it('marks the submission REJECTED', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.update.mockResolvedValue({ id: 'kyc-1', status: KycStatus.REJECTED })

      const result = await service.rejectKyc('kyc-1')

      expect(prisma.partnerUserKyc.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { reviewedAt: expect.any(Date), status: KycStatus.REJECTED },
        where: { id: 'kyc-1' },
      }))
      expect(result).toEqual({ id: 'kyc-1', status: KycStatus.REJECTED })
    })

    it('maps a Prisma P2025 error to NotFoundError', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.update.mockRejectedValue(notFoundPrismaError())

      await expect(service.rejectKyc('missing')).rejects.toThrow(NotFoundError)
    })
  })
})
