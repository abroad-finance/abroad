import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsRole } from '@prisma/client'

import { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { OpsTreasuryThresholdConflictError, OpsTreasuryThresholdService, OpsTreasuryThresholdValidationError } from '../../../../modules/treasury/application/OpsTreasuryThresholdService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const principal: OpsUserPrincipal = {
  authTime: new Date(),
  displayName: 'Finance Operator',
  email: 'finance@abroad.finance',
  kind: 'ops_user',
  permissions: ['treasury:manage', 'treasury:read'],
  role: OpsRole.FINANCE,
  sessionVersion: 1,
  userId: 'finance-1',
}

const thresholdRow = {
  createdAt: new Date('2026-08-02T10:00:00.000Z'),
  createdBy: { displayName: 'Finance Operator', id: 'finance-1' },
  criticalRunwayHours: 4,
  currency: 'BRZ',
  id: 'threshold-1',
  minimumAvailable: 500,
  ownerTeam: 'Treasury',
  updatedAt: new Date('2026-08-02T10:00:00.000Z'),
  updatedBy: { displayName: 'Finance Operator', id: 'finance-1' },
  venue: 'TRANSFERO',
  version: 1,
  warningRunwayHours: 12,
}

const buildHarness = () => {
  const prisma = {
    opsTreasuryThreshold: {
      create: jest.fn(async () => thresholdRow),
      findMany: jest.fn(async () => [thresholdRow]),
      findUnique: jest.fn(async () => thresholdRow),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return {
    prisma,
    service: new OpsTreasuryThresholdService(provider),
    transaction: prisma as unknown as Prisma.TransactionClient,
  }
}

describe('OpsTreasuryThresholdService', () => {
  it('normalizes and creates a currency-specific owner threshold', async () => {
    const harness = buildHarness()

    await harness.service.create(principal, {
      criticalRunwayHours: 4,
      currency: ' brz ',
      minimumAvailable: 500,
      ownerTeam: ' Treasury ',
      venue: ' transfero ',
      warningRunwayHours: 12,
    }, harness.transaction)

    expect(harness.prisma.opsTreasuryThreshold.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        createdByUserId: 'finance-1',
        currency: 'BRZ',
        ownerTeam: 'Treasury',
        venue: 'TRANSFERO',
      }),
    }))
  })

  it('rejects inverted runway policy and stale version updates', async () => {
    const harness = buildHarness()

    await expect(harness.service.create(principal, {
      criticalRunwayHours: 24,
      currency: 'BRZ',
      ownerTeam: 'Treasury',
      venue: 'TRANSFERO',
      warningRunwayHours: 12,
    }, harness.transaction)).rejects.toBeInstanceOf(OpsTreasuryThresholdValidationError)

    harness.prisma.opsTreasuryThreshold.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(harness.service.update(principal, 'threshold-1', {
      currency: 'BRZ',
      minimumAvailable: 600,
      ownerTeam: 'Treasury',
      venue: 'TRANSFERO',
    }, 1, harness.transaction)).rejects.toBeInstanceOf(OpsTreasuryThresholdConflictError)
  })
})
