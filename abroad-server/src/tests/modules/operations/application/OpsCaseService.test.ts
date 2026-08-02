import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsPriority, OpsRole, OpsWorkStatus, TransactionStatus } from '@prisma/client'

import { OpsCaseConflictError, OpsCaseService } from '../../../../modules/operations/application/OpsCaseService'
import { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const principal: OpsUserPrincipal = {
  authTime: new Date(),
  displayName: 'Support Operator',
  email: 'support@abroad.finance',
  kind: 'ops_user',
  permissions: ['cases:manage', 'transactions:read'],
  role: OpsRole.SUPPORT,
  sessionVersion: 1,
  userId: 'ops-1',
}

const caseRow = {
  createdAt: new Date('2026-08-02T10:00:00Z'),
  handoffs: [],
  id: 'case-1',
  notes: [],
  owner: { displayName: 'Support Operator', id: 'ops-1' },
  ownerUserId: 'ops-1',
  priority: OpsPriority.HIGH,
  resolvedAt: null,
  status: OpsWorkStatus.OPEN,
  team: 'Support',
  transaction: {
    createdAt: new Date('2026-08-02T09:00:00Z'),
    id: 'tx-1',
    partnerUser: { partner: { id: 'partner-1', name: 'Partner One' } },
    quote: {
      cryptoCurrency: 'USDC',
      sourceAmount: 100,
      targetAmount: 500,
      targetCurrency: 'BRL',
    },
    status: TransactionStatus.PROCESSING_PAYMENT,
  },
  transactionId: 'tx-1',
  updatedAt: new Date('2026-08-02T10:00:00Z'),
  version: 1,
}

const buildHarness = () => {
  const prisma = {
    opsCase: {
      count: jest.fn(async () => 1),
      create: jest.fn(async () => ({ id: 'case-1' })),
      findMany: jest.fn(async () => [caseRow]),
      findUnique: jest.fn(async () => caseRow),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    opsCaseNote: { create: jest.fn(async () => ({ id: 'note-1' })) },
    opsHandoff: { create: jest.fn(async () => ({ id: 'handoff-1' })) },
    opsUser: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => ({ disabledAt: null, role: OpsRole.SUPPORT })),
    },
    transaction: { findUnique: jest.fn(async () => ({ id: 'tx-1' })) },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return {
    prisma,
    service: new OpsCaseService(provider),
    transaction: prisma as unknown as Prisma.TransactionClient,
  }
}

describe('OpsCaseService', () => {
  it('creates one PII-minimized case linked to a canonical transaction', async () => {
    const harness = buildHarness()

    const result = await harness.service.create(principal, {
      ownerUserId: 'ops-1',
      priority: OpsPriority.HIGH,
      team: ' Support ',
      transactionId: 'tx-1',
    }, harness.transaction)

    expect(harness.prisma.opsCase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerUserId: 'ops-1',
        team: 'Support',
        transactionId: 'tx-1',
      }),
    }))
    expect(result.transaction).toEqual(expect.objectContaining({
      id: 'tx-1',
      partner: { id: 'partner-1', name: 'Partner One' },
    }))
    expect(JSON.stringify(result)).not.toContain('accountNumber')
  })

  it('updates assignment and state with optimistic concurrency', async () => {
    const harness = buildHarness()

    await harness.service.update(principal, 'case-1', {
      ownerUserId: null,
      status: OpsWorkStatus.ACKNOWLEDGED,
      team: 'Operations',
    }, 1, harness.transaction)

    expect(harness.prisma.opsCase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerUserId: null,
        status: OpsWorkStatus.ACKNOWLEDGED,
        team: 'Operations',
        version: { increment: 1 },
      }),
      where: { id: 'case-1', version: 1 },
    }))
  })

  it('rejects a stale case update without overwriting newer work', async () => {
    const harness = buildHarness()
    harness.prisma.opsCase.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(harness.service.update(
      principal,
      'case-1',
      { priority: OpsPriority.CRITICAL },
      1,
      harness.transaction,
    )).rejects.toBeInstanceOf(OpsCaseConflictError)
  })

  it('records an explicit ownership handoff and increments the version', async () => {
    const harness = buildHarness()
    harness.prisma.opsCase.findUnique
      .mockResolvedValueOnce({ ...caseRow, ownerUserId: 'ops-1', team: 'Support' })
      .mockResolvedValueOnce(caseRow)

    await harness.service.handoff(principal, 'case-1', {
      note: 'Escalating after provider ambiguity was verified.',
      toTeam: 'Operations',
      toUserId: null,
    }, 1, harness.transaction)

    expect(harness.prisma.opsHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'ops-1',
        fromTeam: 'Support',
        toTeam: 'Operations',
        toUserId: null,
      }),
    })
  })
})
