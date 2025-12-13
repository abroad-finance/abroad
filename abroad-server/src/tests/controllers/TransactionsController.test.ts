import 'reflect-metadata'
import { TransactionStatus } from '@prisma/client'

import type { IPartnerService } from '../../modules/partners/application/contracts/IPartnerService'
import type { IDatabaseClientProvider } from '../../platform/persistence/IDatabaseClientProvider'

import { TransactionsController } from '../../modules/transactions/interfaces/http/TransactionsController'

type TransactionRecord = {
  createdAt: Date
  id: string
  onChainId: null | string
  partnerUserId: string
  quote: {
    cryptoCurrency: string
    id: string
    network: string
    paymentMethod: string
    sourceAmount: number
    targetAmount: number
    targetCurrency: string
  }
  status: TransactionStatus
}

const buildPrisma = () => {
  const transactions: TransactionRecord[] = [
    {
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      id: 'tx-1',
      onChainId: null,
      partnerUserId: 'partner-user-1',
      quote: {
        cryptoCurrency: 'USDC',
        id: 'quote-1',
        network: 'stellar',
        paymentMethod: 'NEQUI',
        sourceAmount: 10,
        targetAmount: 9,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.PAYMENT_COMPLETED,
    },
  ]

  const prisma = {
    transaction: {
      count: jest.fn(async ({ where }: { where: unknown }) => {
        // basic sanity check that filters are passed through
        expect(where).toBeDefined()
        return transactions.length
      }),
      findMany: jest.fn(async ({ skip, take, where }: { skip: number, take: number, where: unknown }) => {
        expect(skip).toBeGreaterThanOrEqual(0)
        expect(take).toBeGreaterThan(0)
        expect(where).toBeDefined()
        return transactions.slice(skip, skip + take)
      }),
    },
  }

  return prisma
}

const buildController = () => {
  const prisma = buildPrisma()
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const partnerService: IPartnerService = {
    getPartnerFromApiKey: jest.fn(),
    getPartnerFromSepJwt: jest.fn(),
  }
  return { controller: new TransactionsController(dbProvider, partnerService), prisma }
}

const buildBadRequest = () => jest.fn((status: number, payload: { reason: string }) => payload)
const authRequest = (partnerId: string) =>
  ({ user: { id: partnerId } } as unknown as import('express').Request)

describe('TransactionsController', () => {
  it('rejects invalid pagination on confirmed list', async () => {
    const { controller } = buildController()
    const badRequest = buildBadRequest()

    const response = await controller.listConfirmedPartnerTransactions(0, 10, authRequest('p1'), badRequest)

    expect(response).toEqual({ reason: 'Invalid pagination parameters' })
  })

  it('returns confirmed transactions', async () => {
    const { controller, prisma } = buildController()
    const badRequest = buildBadRequest()

    const result = await controller.listConfirmedPartnerTransactions(2, 1, authRequest('partner-1'), badRequest)

    expect(badRequest).not.toHaveBeenCalled()
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      include: { quote: true },
      orderBy: { createdAt: 'desc' },
      skip: 1,
      take: 1,
      where: {
        partnerUser: { partnerId: 'partner-1' },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })
    expect(result).toEqual({
      page: 2,
      pageSize: 1,
      total: 1,
      transactions: expect.any(Array),
    })
  })

  it('rejects invalid pagination on generic list', async () => {
    const { controller } = buildController()
    const badRequest = buildBadRequest()

    const response = await controller.listPartnerTransactions(1, 0, 'external', authRequest('p1'), badRequest)

    expect(response).toEqual({ reason: 'Invalid pagination parameters' })
  })

  it('returns partner transactions scoped by external user', async () => {
    const { controller, prisma } = buildController()
    const badRequest = buildBadRequest()

    const result = await controller.listPartnerTransactions(1, 5, 'external-user', authRequest('partner-9'), badRequest)

    expect(badRequest).not.toHaveBeenCalled()
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      include: { quote: true },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 5,
      where: { partnerUser: { partnerId: 'partner-9', userId: 'external-user' } },
    })
    expect(result.total).toBe(1)
    expect(result.transactions[0]).toEqual(expect.objectContaining({ id: 'tx-1' }))
  })
})
