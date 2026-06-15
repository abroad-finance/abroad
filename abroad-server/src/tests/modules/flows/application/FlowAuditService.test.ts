import 'reflect-metadata'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { FlowAuditService } from '../../../../modules/flows/application/FlowAuditService'

type PrismaMock = {
  $transaction: jest.Mock
  flowInstance: { count: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock }
  transaction: { findFirst: jest.Mock, findMany: jest.Mock, findUnique: jest.Mock }
}

const makePrisma = (): PrismaMock => ({
  $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  flowInstance: {
    count: jest.fn(async () => 0),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(),
  },
  transaction: {
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(),
  },
})

const makeService = (prisma: PrismaMock): FlowAuditService => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  return new FlowAuditService(dbProvider, {} as never)
}

describe('FlowAuditService.list on-chain id filter', () => {
  it('resolves an on-chain id to its transaction id and filters flows by it', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValueOnce({ id: 'tx-123' })

    await makeService(prisma).list({ onChainId: '0xabc' })

    expect(prisma.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { onChainId: '0xabc' } }),
    )
    expect(prisma.flowInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ transactionId: 'tx-123' }) }),
    )
  })

  it('matches no flows when no transaction has the given on-chain id', async () => {
    const prisma = makePrisma()
    prisma.transaction.findFirst.mockResolvedValueOnce(null)

    const result = await makeService(prisma).list({ onChainId: 'missing' })

    expect(prisma.flowInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ transactionId: { in: [] } }) }),
    )
    expect(result.items).toEqual([])
  })
})
