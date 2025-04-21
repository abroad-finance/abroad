import { KycStatus, PaymentMethod } from '@prisma/client'
import { Request as RequestExpress } from 'express'

import { CreatePartnerUserRequest, PartnerUserController } from '../../src/controllers/PartnerUserController'
import { IPartnerService } from '../../src/interfaces'
import { IDatabaseClientProvider } from '../../src/interfaces/IDatabaseClientProvider'

describe('PartnerUserController', () => {
  let partnerServiceMock: jest.Mocked<IPartnerService>
  let dbProviderMock: jest.Mocked<IDatabaseClientProvider>
  let controller: PartnerUserController
  let request: jest.Mocked<RequestExpress>
  let badRequestResponse: jest.Mock<unknown, [number, { reason: string }]>

  beforeEach(() => {
    partnerServiceMock = { getPartnerFromRequest: jest.fn() } as unknown as jest.Mocked<IPartnerService>
    dbProviderMock = { getClient: jest.fn() } as unknown as jest.Mocked<IDatabaseClientProvider>
    controller = new PartnerUserController(dbProviderMock, partnerServiceMock)
    request = { header: jest.fn() } as unknown as jest.Mocked<RequestExpress>
    badRequestResponse = jest.fn()
  })

  describe('createPartnerUser', () => {
    const partner = { id: 'partner-1' }
    const userId = 'user-123'
    const paymentMethod = PaymentMethod.NEQUI
    const bank = 'BANKCODE'
    const accountNumber = '123456'

    it('should return bad request when user_id is missing', async () => {
      ;(request.header as jest.Mock).mockReturnValue('api-key')
      await controller.createPartnerUser({} as CreatePartnerUserRequest, request as unknown as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'user_id is required' })
    })

    it('should create partner user when input is valid', async () => {
      ;(request.header as jest.Mock).mockReturnValue('api-key')
      ;(partnerServiceMock.getPartnerFromRequest as jest.Mock).mockResolvedValue(partner)
      const pu = {
        accountNumber, bank, createdAt: new Date(), id: 'pu-1', kycStatus: KycStatus.PENDING,
        paymentMethod,
        updatedAt: new Date(), userId,
      }
      const prismaMock = { partnerUser: { create: jest.fn().mockResolvedValue(pu) } }
      ;(dbProviderMock.getClient as jest.Mock).mockResolvedValue(prismaMock)

      const result = await controller.createPartnerUser(
        { account_number: accountNumber, bank, payment_method: paymentMethod, user_id: userId },
        request as RequestExpress,
        badRequestResponse,
      )

      expect(result).toEqual({
        accountNumber: pu.accountNumber,
        bank: pu.bank,
        createdAt: pu.createdAt,
        id: pu.id,
        kycStatus: pu.kycStatus,
        paymentMethod: pu.paymentMethod,
        updatedAt: pu.updatedAt,
        userId: pu.userId,
      })
      expect(prismaMock.partnerUser.create).toHaveBeenCalledWith({
        data: { accountNumber, bank, partnerId: partner.id, paymentMethod, userId },
      })
    })

    it('should return bad request when prisma.create fails', async () => {
      ;(request.header as jest.Mock).mockReturnValue('api-key')
      ;(partnerServiceMock.getPartnerFromRequest as jest.Mock).mockResolvedValue(partner)
      const prismaMock = { partnerUser: { create: jest.fn().mockRejectedValue(new Error('fail')) } }
      ;(dbProviderMock.getClient as jest.Mock).mockResolvedValue(prismaMock)

      await controller.createPartnerUser({ user_id: userId }, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'Failed to create partner user' })
    })
  })

  describe('listPartnerUsers', () => {
    const partner = { id: 'partner-1' }

    it('should return bad request for invalid pagination', async () => {
      await controller.listPartnerUsers(0, 101, request as RequestExpress, badRequestResponse)
      expect(badRequestResponse).toHaveBeenCalledWith(400, { reason: 'Invalid pagination parameters' })
    })

    it('should return paginated users', async () => {
      ;(request.header as jest.Mock).mockReturnValue('api-key')
      ;(partnerServiceMock.getPartnerFromRequest as jest.Mock).mockResolvedValue(partner)
      const us = [
        { accountNumber: 'a', bank: 'b', createdAt: new Date(), id: '1', kycStatus: KycStatus.APPROVED, paymentMethod: PaymentMethod.MOVII, updatedAt: new Date(), userId: 'u1' },
        { accountNumber: null, bank: null, createdAt: new Date(), id: '2', kycStatus: KycStatus.PENDING, paymentMethod: null, updatedAt: new Date(), userId: 'u2' },
      ]
      const total = 2
      const prismaMock = {
        partnerUser: {
          count: jest.fn().mockResolvedValue(total),
          findMany: jest.fn().mockResolvedValue(us),
        },
      }
      ;(dbProviderMock.getClient as jest.Mock).mockResolvedValue(prismaMock)

      const page = 2, pageSize = 1
      const result = await controller.listPartnerUsers(page, pageSize, request as RequestExpress, badRequestResponse)

      expect(result).toEqual({
        page,
        pageSize,
        total,
        users: us.map(u => ({
          accountNumber: u.accountNumber,
          bank: u.bank,
          createdAt: u.createdAt,
          id: u.id,
          kycStatus: u.kycStatus,
          paymentMethod: u.paymentMethod,
          updatedAt: u.updatedAt,
          userId: u.userId,
        })),
      })
      expect(prismaMock.partnerUser.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        where: { partnerId: partner.id },
      })
      expect(prismaMock.partnerUser.count).toHaveBeenCalledWith({ where: { partnerId: partner.id } })
    })
  })
})
