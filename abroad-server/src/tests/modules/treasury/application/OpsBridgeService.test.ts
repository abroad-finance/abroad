import 'reflect-metadata'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsBridgeService } from '../../../../modules/treasury/application/OpsBridgeService'

type PrismaMock = {
  bridgeBatch: { findMany: jest.Mock, findUnique: jest.Mock }
  bridgePendingTransfer: { findFirst: jest.Mock, findMany: jest.Mock, groupBy: jest.Mock }
  transaction: { findMany: jest.Mock }
}

const makePrisma = (): PrismaMock => ({
  bridgeBatch: {
    findMany: jest.fn(async () => []),
    findUnique: jest.fn(async () => null),
  },
  bridgePendingTransfer: {
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
    groupBy: jest.fn(async () => []),
  },
  transaction: { findMany: jest.fn(async () => []) },
})

const makeService = (
  prisma: PrismaMock,
  cap: number | undefined,
): OpsBridgeService => {
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const floatService = { getCapUsdc: jest.fn(() => cap) }
  return new OpsBridgeService(dbProvider, floatService as never)
}

describe('OpsBridgeService.getOverview', () => {
  it('computes the float gauge from the outstanding (PENDING + BATCHED) deficit against the cap', async () => {
    const prisma = makePrisma()
    prisma.bridgePendingTransfer.groupBy.mockResolvedValue([
      { _count: { _all: 3 }, _sum: { amount: 12 }, status: 'PENDING' },
      { _count: { _all: 1 }, _sum: { amount: 5 }, status: 'BATCHED' },
      { _count: { _all: 2 }, _sum: { amount: 8 }, status: 'SETTLED' },
    ])

    const overview = await makeService(prisma, 2000).getOverview()

    expect(overview.float).toEqual({ available: 1983, cap: 2000, deficit: 17, enabled: true })
    expect(overview.legs.total).toBe(6)
    expect(overview.legs.recent).toEqual([])
    expect(overview.legs.byStatus).toEqual(
      expect.arrayContaining([
        { amount: 12, count: 3, status: 'PENDING' },
        { amount: 8, count: 2, status: 'SETTLED' },
      ]),
    )
  })

  it('reports the float as disabled (no cap) but still surfaces the deficit', async () => {
    const prisma = makePrisma()
    prisma.bridgePendingTransfer.groupBy.mockResolvedValue([
      { _count: { _all: 1 }, _sum: { amount: 4 }, status: 'PENDING' },
    ])

    const overview = await makeService(prisma, undefined).getOverview()

    expect(overview.float).toEqual({ available: null, cap: null, deficit: 4, enabled: false })
  })

  it('maps batches with their member counts and surfaces the oldest pending leg time', async () => {
    const prisma = makePrisma()
    const oldest = new Date('2026-06-01T00:00:00Z')
    prisma.bridgePendingTransfer.findFirst.mockResolvedValue({ createdAt: oldest })
    prisma.bridgeBatch.findMany.mockResolvedValue([
      {
        _count: { members: 4 },
        asset: 'USDC',
        createdAt: new Date('2026-06-10T00:00:00Z'),
        destNetwork: 'SOLANA',
        grossAmount: 20,
        id: 'batch-1',
        settledAt: null,
        status: 'SUBMITTED',
        withdrawFee: 1,
        withdrawId: 'w-1',
      },
    ])

    const overview = await makeService(prisma, 2000).getOverview()

    expect(overview.legs.oldestPendingAt).toEqual(oldest)
    expect(overview.batches).toEqual([
      expect.objectContaining({
        id: 'batch-1',
        memberCount: 4,
        reconciliationState: 'AWAITING_PROVIDER',
        status: 'SUBMITTED',
        withdrawId: 'w-1',
      }),
    ])
    expect(prisma.bridgePendingTransfer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' }, where: { status: 'PENDING' } }),
    )
  })
})

describe('OpsBridgeService.getBatchDetail', () => {
  it('links every constituent leg to its transaction, SLA, reconciliation, incident, and provider reference', async () => {
    const prisma = makePrisma()
    prisma.bridgeBatch.findUnique.mockResolvedValue({
      asset: 'USDC',
      createdAt: new Date('2026-08-02T10:00:00.000Z'),
      destNetwork: 'POLYGON',
      grossAmount: 25,
      id: 'batch-1',
      members: [{
        amount: 25,
        asset: 'USDC',
        batchId: 'batch-1',
        createdAt: new Date('2026-08-02T09:00:00.000Z'),
        destNetwork: 'POLYGON',
        id: 'leg-1',
        status: 'BATCHED',
        transactionId: 'transaction-1',
        updatedAt: new Date('2026-08-02T10:00:00.000Z'),
      }],
      settledAt: null,
      status: 'SUBMITTED',
      withdrawFee: 0.1,
      withdrawId: 'provider-withdrawal-1',
    })
    prisma.transaction.findMany.mockResolvedValue([{
      id: 'transaction-1',
      partnerUser: { partner: { id: 'partner-1', name: 'Partner One' } },
      status: 'PROCESSING_PAYMENT',
    }])

    const detail = await makeService(prisma, 2_000).getBatchDetail('batch-1')

    expect(detail.providerReference).toBe('provider-withdrawal-1')
    expect(detail.members[0]).toEqual(expect.objectContaining({
      incidentPath: '/ops/incidents?kind=BRIDGE&query=leg-1',
      reconciliationState: 'AWAITING_PROVIDER',
      transaction: {
        id: 'transaction-1',
        partner: { id: 'partner-1', name: 'Partner One' },
        status: 'PROCESSING_PAYMENT',
      },
    }))
  })
})
