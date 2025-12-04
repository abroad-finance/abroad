import 'reflect-metadata'
import { Prisma } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'

import { PartnerUserController } from '../../controllers/PartnerUserController'

type PartnerUserRecord = {
  createdAt: Date
  id: string
  kycExternalToken: null | string
  partnerId: string
  updatedAt: Date
  userId: string
}

type PrismaMock = {
  partnerUser: {
    count: jest.MockedFunction<(args?: unknown) => Promise<number>>
    create: jest.MockedFunction<
      (args: { data: Partial<PartnerUserRecord> }) => Promise<PartnerUserRecord>
    >
    findMany: jest.MockedFunction<(args?: unknown) => Promise<PartnerUserRecord[]>>
    update: jest.MockedFunction<
      (args: { data?: Partial<PartnerUserRecord>, where: { partnerId_userId: { partnerId?: string, userId: string } } }) =>
      Promise<PartnerUserRecord>
    >
  }
}

const buildPrisma = (): PrismaMock => ({
  partnerUser: {
    count: jest.fn(async () => 1),
    create: jest.fn(async ({ data }: { data: Partial<PartnerUserRecord> }): Promise<PartnerUserRecord> => ({
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      id: 'pu-1',
      kycExternalToken: data.kycExternalToken ?? null,
      partnerId: data.partnerId ?? 'partner-1',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      userId: data.userId ?? 'user-1',
    })),
    findMany: jest.fn(async (): Promise<PartnerUserRecord[]> => [
      {
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        id: 'pu-1',
        kycExternalToken: null,
        partnerId: 'partner-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        userId: 'user-1',
      },
    ]),
    update: jest.fn(async ({ where }: { where: { partnerId_userId: { userId: string } } }): Promise<PartnerUserRecord> => ({
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      id: 'pu-1',
      kycExternalToken: 'token',
      partnerId: 'partner-1',
      updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      userId: where.partnerId_userId.userId,
    })),
  },
})

const buildController = (prisma: PrismaMock) => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }

  const paymentServiceFactory: IPaymentServiceFactory = {
    getPaymentService: jest.fn(),
  }

  const controller = new PartnerUserController(dbProvider, paymentServiceFactory)
  return { controller, dbProvider, paymentServiceFactory }
}

const buildBadRequest = () => jest.fn((status: number, payload: { reason: string }) => payload)
const buildResponse = () => jest.fn((status: number, payload: { reason: string }) => payload)

const authRequest = (partnerId: string) =>
  ({ user: { id: partnerId } } as unknown as import('express').Request)

describe('PartnerUserController', () => {
  it('rejects invalid create payloads', async () => {
    const prisma = buildPrisma()
    const { controller } = buildController(prisma)
    const badRequest = buildBadRequest()

    const response = await controller.createPartnerUser(
      // missing required userId
      { userId: '' },
      authRequest('partner-1'),
      badRequest,
    )

    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Invalid payload' })
    expect(response).toEqual({ reason: 'Invalid payload' })
    expect(prisma.partnerUser.create).not.toHaveBeenCalled()
  })

  it('creates a partner user and returns DTO', async () => {
    const prisma = buildPrisma()
    const { controller } = buildController(prisma)
    const badRequest = buildBadRequest()

    const dto = await controller.createPartnerUser(
      { kycExternalToken: 'ext', userId: 'b4b94060-0c36-4d1e-9b8b-9d5a9e0e9187' },
      authRequest('partner-xyz'),
      badRequest,
    )

    expect(badRequest).not.toHaveBeenCalled()
    expect(prisma.partnerUser.create).toHaveBeenCalledWith({
      data: {
        kycExternalToken: 'ext',
        partnerId: 'partner-xyz',
        userId: 'b4b94060-0c36-4d1e-9b8b-9d5a9e0e9187',
      },
    })
    expect(dto).toEqual({
      createdAt: expect.any(Date),
      id: 'pu-1',
      kycToken: 'ext',
      updatedAt: expect.any(Date),
      userId: 'b4b94060-0c36-4d1e-9b8b-9d5a9e0e9187',
    })
  })

  it('rejects invalid pagination parameters', async () => {
    const prisma = buildPrisma()
    const { controller } = buildController(prisma)
    const badRequest = buildBadRequest()

    const response = await controller.listPartnerUsers(0, 10, authRequest('partner-1'), badRequest)

    expect(response).toEqual({ reason: 'Invalid pagination parameters' })
    expect(prisma.partnerUser.findMany).not.toHaveBeenCalled()
  })

  it('returns paginated partner users', async () => {
    const prisma = buildPrisma()
    prisma.partnerUser.count.mockResolvedValueOnce(5)
    prisma.partnerUser.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        id: 'pu-2',
        kycExternalToken: 'kyc',
        partnerId: 'partner-1',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
        userId: 'user-2',
      },
    ])
    const { controller } = buildController(prisma)
    const badRequest = buildBadRequest()

    const response = await controller.listPartnerUsers(2, 1, authRequest('partner-1'), badRequest)

    expect(badRequest).not.toHaveBeenCalled()
    expect(prisma.partnerUser.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      skip: 1,
      take: 1,
      where: { partnerId: 'partner-1' },
    })
    expect(response).toEqual({
      page: 2,
      pageSize: 1,
      total: 5,
      users: [
        {
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          id: 'pu-2',
          kycToken: 'kyc',
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          userId: 'user-2',
        },
      ],
    })
  })

  it('validates update payload and returns 400 on empty body', async () => {
    const prisma = buildPrisma()
    const { controller } = buildController(prisma)
    const responseFn = buildResponse()

    const response = await controller.updatePartnerUser(
      'user-1',
      {},
      authRequest('partner-1'),
      responseFn,
    )

    expect(responseFn).toHaveBeenCalledWith(400, { reason: 'At least one field must be supplied' })
    expect(response).toEqual({ reason: 'At least one field must be supplied' })
  })

  it('returns 404 when update target does not exist', async () => {
    const prisma = buildPrisma()
    prisma.partnerUser.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('not found', { clientVersion: '1.0', code: 'P2025' }),
    )
    const { controller } = buildController(prisma)
    const responseFn = buildResponse()

    const response = await controller.updatePartnerUser(
      'missing-user',
      { kycExternalToken: null },
      authRequest('partner-1'),
      responseFn,
    )

    expect(responseFn).toHaveBeenCalledWith(404, { reason: 'Partner user not found' })
    expect(response).toEqual({ reason: 'Partner user not found' })
  })

  it('updates a partner user successfully', async () => {
    const prisma = buildPrisma()
    const { controller } = buildController(prisma)
    const responseFn = buildResponse()

    const dto = await controller.updatePartnerUser(
      'user-1',
      { kycExternalToken: 'token-updated' },
      authRequest('partner-1'),
      responseFn,
    )

    expect(prisma.partnerUser.update).toHaveBeenCalledWith({
      data: { kycExternalToken: 'token-updated' },
      where: {
        partnerId_userId: {
          partnerId: 'partner-1',
          userId: 'user-1',
        },
      },
    })
    expect(responseFn).not.toHaveBeenCalled()
    expect(dto).toEqual({
      createdAt: expect.any(Date),
      id: 'pu-1',
      kycToken: 'token',
      updatedAt: expect.any(Date),
      userId: 'user-1',
    })
  })
})
