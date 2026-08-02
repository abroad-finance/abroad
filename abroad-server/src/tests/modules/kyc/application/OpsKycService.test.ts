import 'reflect-metadata'
import { DocumentType, KycStatus, OpsRole, Prisma } from '@prisma/client'

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
  opsReviewer: null,
  opsReviewerUserId: null,
  opsReviewVersion: 3,
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
    $transaction: jest.fn(),
    opsUser: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    partnerUser: {
      update: jest.fn(),
    },
    partnerUserKyc: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  }
  prisma.$transaction.mockImplementation(async (
    callback: (transaction: typeof prisma) => Promise<unknown>,
  ) => callback(prisma))

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
        documentNumberMasked: '•••• C123',
        emailMasked: 'a•••@example.com',
        fullNameMasked: 'A•• L••',
        hasDocument: true,
        id: 'kyc-1',
        partnerId: 'partner-1',
        partnerName: 'Acme Inc',
        partnerUserId: 'pu-1',
        status: KycStatus.APPROVED,
        submittedAt: new Date('2024-05-01T00:00:00Z'),
        version: 3,
      })
      expect(result.items[0]).not.toHaveProperty('address')
      expect(result.items[0]).not.toHaveProperty('documentNumber')
      expect(result.items[0]).not.toHaveProperty('phone')
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

    it('combines investigation, date, ownership, document, and SLA filters', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findMany.mockResolvedValue([])
      prisma.partnerUserKyc.count.mockResolvedValue(0)
      const createdFrom = new Date('2026-07-01T00:00:00.000Z')

      await service.listSubmissions({
        ageHoursGte: 24,
        createdFrom,
        documentType: DocumentType.PASSPORT,
        nationality: 'BR',
        page: 1,
        pageSize: 20,
        partnerId: 'partner-1',
        query: 'Ada',
        reviewer: 'UNASSIGNED',
        status: KycStatus.PENDING_APPROVAL,
      })

      const call = prisma.partnerUserKyc.findMany.mock.calls[0]?.[0]
      expect(call.where).toEqual(expect.objectContaining({
        createdAt: expect.objectContaining({ gte: createdFrom, lte: expect.any(Date) }),
        documentType: DocumentType.PASSPORT,
        nationality: { equals: 'BR', mode: 'insensitive' },
        opsReviewerUserId: null,
        partnerUser: { partnerId: 'partner-1' },
        status: KycStatus.PENDING_APPROVAL,
      }))
      expect(call.where.OR).toHaveLength(4)
    })
  })

  describe('review ownership', () => {
    it('assigns an enabled decision maker with optimistic concurrency', async () => {
      const { prisma, service } = buildHarness()
      prisma.opsUser.findUnique.mockResolvedValue({
        disabledAt: null,
        id: 'reviewer-1',
        role: OpsRole.COMPLIANCE,
      })
      prisma.partnerUserKyc.updateMany.mockResolvedValue({ count: 1 })
      prisma.partnerUserKyc.findUnique.mockResolvedValue({
        id: 'kyc-1',
        opsReviewer: {
          displayName: 'Compliance Operator',
          id: 'reviewer-1',
          role: OpsRole.COMPLIANCE,
        },
        opsReviewVersion: 4,
      })

      const result = await service.assignReviewer('kyc-1', 'reviewer-1', 3)

      expect(prisma.partnerUserKyc.updateMany).toHaveBeenCalledWith({
        data: {
          opsReviewerUserId: 'reviewer-1',
          opsReviewVersion: { increment: 1 },
        },
        where: { id: 'kyc-1', opsReviewVersion: 3 },
      })
      expect(result).toEqual({
        id: 'kyc-1',
        reviewer: {
          displayName: 'Compliance Operator',
          id: 'reviewer-1',
          role: OpsRole.COMPLIANCE,
        },
        version: 4,
      })
    })

    it('rejects disabled or unauthorized reviewers', async () => {
      const { prisma, service } = buildHarness()
      prisma.opsUser.findUnique.mockResolvedValue({
        disabledAt: null,
        id: 'reviewer-1',
        role: OpsRole.SUPPORT,
      })

      await expect(service.assignReviewer('kyc-1', 'reviewer-1', 3)).rejects.toThrow(
        'Reviewer must be an enabled KYC decision maker',
      )
      expect(prisma.partnerUserKyc.updateMany).not.toHaveBeenCalled()
    })

    it('rejects a stale assignment version', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.updateMany.mockResolvedValue({ count: 0 })
      prisma.partnerUserKyc.count.mockResolvedValue(1)

      await expect(service.assignReviewer('kyc-1', null, 2)).rejects.toThrow(
        'This KYC review changed after it was loaded',
      )
    })

    it('lists only enabled compliance-capable reviewers', async () => {
      const { prisma, service } = buildHarness()
      prisma.opsUser.findMany.mockResolvedValue([{
        displayName: 'Compliance Operator',
        id: 'reviewer-1',
        role: OpsRole.COMPLIANCE,
      }])

      const result = await service.listReviewers()

      expect(prisma.opsUser.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          disabledAt: null,
          role: { in: [OpsRole.COMPLIANCE, OpsRole.ADMINISTRATOR] },
        },
      }))
      expect(result).toHaveLength(1)
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

  describe('getSubmission', () => {
    it('returns sensitive details only from the deliberate detail query', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findUnique.mockResolvedValue(buildKycRecord())

      const result = await service.getSubmission('kyc-1')

      expect(result).toMatchObject({
        address: '742 Evergreen Terrace',
        documentNumber: 'ABC123',
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        phone: '+5712345678',
        userId: 'user-1',
        version: 3,
      })
    })

    it('throws when the submission is missing', async () => {
      const { prisma, service } = buildHarness()
      prisma.partnerUserKyc.findUnique.mockResolvedValue(null)

      await expect(service.getSubmission('kyc-1')).rejects.toThrow(NotFoundError)
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
