import 'reflect-metadata'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsTransactionNotFoundError, OpsTransactionQueryService } from '../../../../modules/transactions/application/OpsTransactionQueryService'

type PrismaMock = {
  flowInstance: { findUnique: jest.Mock }
  transaction: { count: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock }
}

const makePrisma = (): PrismaMock => ({
  flowInstance: { findUnique: jest.fn(async () => null) },
  transaction: {
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
  },
})

const makeService = (prisma: PrismaMock): OpsTransactionQueryService => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  return new OpsTransactionQueryService(dbProvider)
}

const quote = {
  country: 'CO',
  cryptoCurrency: 'USDC',
  network: 'CELO',
  paymentMethod: 'PIX',
  sourceAmount: 25,
  targetAmount: 50,
  targetCurrency: 'BRL',
}

const txRow = {
  accountNumber: '123',
  bankCode: '001',
  createdAt: new Date('2026-06-10'),
  exchangeHandoffAt: null,
  externalId: 'ext-1',
  id: 'tx-1',
  onChainId: '0xabc',
  partnerUser: { partnerId: 'p1', userId: 'u1' },
  qrCode: null,
  quote,
  refundOnChainId: null,
  status: 'PAYMENT_COMPLETED',
  taxId: null,
}

describe('OpsTransactionQueryService.search', () => {
  it('filters by status and partner, paginates, and orders newest first', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([txRow])
    prisma.transaction.count.mockResolvedValue(31)

    const result = await makeService(prisma).search({
      page: 2,
      pageSize: 10,
      partnerId: 'p1',
      status: 'PAYMENT_COMPLETED' as never,
    })

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
        where: expect.objectContaining({
          partnerUser: { partnerId: 'p1' },
          status: 'PAYMENT_COMPLETED',
        }),
      }),
    )
    expect(result.total).toBe(31)
    expect(result.page).toBe(2)
    expect(result.items[0]).toEqual(
      expect.objectContaining({ id: 'tx-1', onChainId: '0xabc', partnerId: 'p1', userId: 'u1' }),
    )
    expect(result.items[0].quote).toEqual(expect.objectContaining({ sourceAmount: 25, targetAmount: 50 }))
  })

  it('filters by onChainId and userId when provided', async () => {
    const prisma = makePrisma()
    await makeService(prisma).search({ onChainId: '0xabc', userId: 'u1' })

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          onChainId: '0xabc',
          partnerUser: { userId: 'u1' },
        }),
      }),
    )
  })
})

describe('OpsTransactionQueryService.getById', () => {
  it('returns the transaction detail with its linked flow instance id', async () => {
    const prisma = makePrisma()
    prisma.transaction.findUnique.mockResolvedValue(txRow)
    prisma.flowInstance.findUnique.mockResolvedValue({ id: 'flow-1' })

    const detail = await makeService(prisma).getById('tx-1')

    expect(detail.id).toBe('tx-1')
    expect(detail.flowInstanceId).toBe('flow-1')
    expect(detail.accountNumber).toBe('123')
    expect(prisma.flowInstance.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { transactionId: 'tx-1' } }),
    )
  })

  it('throws when the transaction does not exist', async () => {
    const prisma = makePrisma()
    prisma.transaction.findUnique.mockResolvedValue(null)

    await expect(makeService(prisma).getById('missing'))
      .rejects.toBeInstanceOf(OpsTransactionNotFoundError)
  })
})
