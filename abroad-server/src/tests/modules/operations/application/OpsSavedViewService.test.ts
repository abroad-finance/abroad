import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsRole, OpsSavedViewResource, OpsSavedViewScope } from '@prisma/client'

import { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { OpsSavedViewNotFoundError, OpsSavedViewService } from '../../../../modules/operations/application/OpsSavedViewService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const principal: OpsUserPrincipal = {
  authTime: new Date(),
  displayName: 'Operations User',
  email: 'operations@abroad.finance',
  kind: 'ops_user',
  permissions: ['saved_views:manage', 'transactions:read'],
  role: OpsRole.OPERATIONS,
  sessionVersion: 1,
  userId: 'ops-1',
}

const viewRow = {
  createdAt: new Date('2026-08-02T10:00:00Z'),
  filters: { attention: 'ALL', query: 'provider-ref' },
  id: 'view-1',
  name: 'Provider exceptions',
  owner: { displayName: 'Operations User', id: 'ops-1' },
  ownerUserId: 'ops-1',
  resource: OpsSavedViewResource.TRANSACTIONS,
  scope: OpsSavedViewScope.TEAM,
  updatedAt: new Date('2026-08-02T10:00:00Z'),
  version: 1,
}

const buildHarness = () => {
  const prisma = {
    opsSavedView: {
      create: jest.fn(async () => viewRow),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [viewRow]),
      findUnique: jest.fn(async () => viewRow),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return {
    prisma,
    service: new OpsSavedViewService(provider),
    transaction: prisma as unknown as Prisma.TransactionClient,
  }
}

describe('OpsSavedViewService', () => {
  it('stores only an allowlisted, normalized transaction filter envelope', async () => {
    const harness = buildHarness()

    const result = await harness.service.create(principal, {
      filters: { attention: 'ALL', pageSize: 50, query: ' provider-ref ' },
      name: '  Provider   exceptions ',
      resource: OpsSavedViewResource.TRANSACTIONS,
      scope: OpsSavedViewScope.TEAM,
    }, harness.transaction)

    expect(harness.prisma.opsSavedView.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        filters: { attention: 'ALL', pageSize: 50, query: 'provider-ref' },
        name: 'Provider exceptions',
        ownerUserId: 'ops-1',
      }),
    }))
    expect(result.scope).toBe(OpsSavedViewScope.TEAM)
  })

  it('lists the current user private views plus shared team views', async () => {
    const harness = buildHarness()

    await harness.service.list(principal, OpsSavedViewResource.TRANSACTIONS)

    expect(harness.prisma.opsSavedView.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { ownerUserId: 'ops-1' },
          { scope: OpsSavedViewScope.TEAM },
        ],
        resource: OpsSavedViewResource.TRANSACTIONS,
      },
    }))
  })

  it('does not reveal whether another user private view exists when writing', async () => {
    const harness = buildHarness()
    harness.prisma.opsSavedView.findUnique.mockResolvedValueOnce({
      ...viewRow,
      id: 'view-2',
      ownerUserId: 'ops-2',
    })

    await expect(harness.service.delete(principal, 'view-2', 1, harness.transaction))
      .rejects.toBeInstanceOf(OpsSavedViewNotFoundError)
    expect(harness.prisma.opsSavedView.deleteMany).not.toHaveBeenCalled()
  })
})
