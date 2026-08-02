import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { FlowInstanceStatus, OpsIncidentSeverity } from '@prisma/client'

import { OpsIncidentDetectionService } from '../../../../modules/operations/application/OpsIncidentDetectionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const NOW = new Date('2026-08-02T16:00:00.000Z')

const buildHarness = (flowCount: number) => {
  const flows = Array.from({ length: flowCount }, (_, index) => ({
    createdAt: new Date(NOW.getTime() - 60_000),
    flowSnapshot: { payoutProvider: 'PIX' },
    id: `flow-${String(index).padStart(2, '0')}`,
    status: FlowInstanceStatus.FAILED,
    steps: [{ error: { message: 'provider rate limit 429' }, stepType: 'CREATE_PAYOUT', updatedAt: NOW }],
    transactionId: `transaction-${index}`,
    updatedAt: new Date(NOW.getTime() - index * 1_000),
  }))
  const prisma = {
    $transaction: jest.fn(async <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> => (
      callback(prisma as unknown as Prisma.TransactionClient)
    )),
    bridgeBatch: { findMany: jest.fn(async () => []) },
    bridgePendingTransfer: { findMany: jest.fn(async () => []) },
    flowInstance: { findMany: jest.fn(async () => flows) },
    opsIncident: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({ id: 'resolved-incident' })),
      upsert: jest.fn(async () => ({ id: 'incident-1' })),
    },
    opsRunbook: { findMany: jest.fn(async () => []) },
    outboxEvent: { findMany: jest.fn(async () => []) },
    transaction: { findMany: jest.fn(async () => []) },
  }
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  const treasuryService = {
    getBalances: jest.fn(async () => ({
      capturedAt: NOW,
      cells: [],
      errors: [],
    })),
  }
  const auditService = { recordSystem: jest.fn(async () => undefined) }
  return {
    auditService,
    prisma,
    service: new OpsIncidentDetectionService(
      databaseClientProvider,
      treasuryService as never,
      auditService as never,
    ),
  }
}

describe('OpsIncidentDetectionService', () => {
  it('groups failures under a stable fingerprint without truncating the true affected count', async () => {
    const harness = buildHarness(25)

    const detections = await harness.service.detect(NOW)

    expect(detections).toHaveLength(1)
    expect(detections[0]).toMatchObject({
      affectedCount: 25,
      fingerprint: 'flow:RATE_LIMIT:PIX',
      kind: 'RATE_LIMIT',
      occurrenceCount: 25,
      severity: OpsIncidentSeverity.CRITICAL,
    })
    expect(detections[0].context.affected).toHaveLength(20)
    expect(detections[0].context.filters).toEqual([{
      label: 'Open affected flows',
      path: '/ops/flows?failure=FAILED_FLOW&payoutProvider=PIX',
    }])
    expect(JSON.stringify(detections[0])).not.toContain('provider rate limit 429')
  })

  it('persists the deterministic incident and attributes the created ID in system audit evidence', async () => {
    const harness = buildHarness(1)

    await expect(harness.service.sync(NOW)).resolves.toEqual({
      active: 1,
      created: 1,
      reopened: 0,
      resolved: 0,
    })

    expect(harness.prisma.opsIncident.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        fingerprint: 'ops-auto:v1:flow:RATE_LIMIT:PIX',
      }),
      where: { fingerprint: 'ops-auto:v1:flow:RATE_LIMIT:PIX' },
    }))
    expect(harness.auditService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'incident.detected',
      resourceId: 'incident-1',
      resourceType: 'ops_incident',
    }), expect.anything())
  })
})
