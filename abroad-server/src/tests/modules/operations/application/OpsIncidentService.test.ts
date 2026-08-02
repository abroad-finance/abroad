import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsIncidentSeverity, OpsPriority, OpsRole, OpsWorkStatus } from '@prisma/client'

import { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import { OpsIncidentService } from '../../../../modules/operations/application/OpsIncidentService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const principal: OpsUserPrincipal = {
  authTime: new Date(),
  displayName: 'Operations Operator',
  email: 'operator@abroad.finance',
  kind: 'ops_user',
  permissions: ['incidents:manage', 'incidents:read'],
  role: OpsRole.OPERATIONS,
  sessionVersion: 1,
  userId: 'ops-1',
}

const incidentRow = {
  acknowledgedAt: null,
  affectedCount: 3,
  context: {
    affected: [{ id: 'flow-1', label: 'Flow flow-1', path: '/ops/flows/flow-1', type: 'FLOW' }],
    dimensions: [{ label: 'Provider', value: 'PIX' }],
    filters: [{ label: 'Open affected flows', path: '/ops/flows?failure=FAILED_FLOW' }],
  },
  fingerprint: 'ops-auto:v1:flow:RATE_LIMIT:PIX',
  firstSeenAt: new Date('2026-08-02T10:00:00.000Z'),
  handoffs: [],
  id: 'incident-1',
  kind: 'RATE_LIMIT',
  lastSeenAt: new Date('2026-08-02T11:00:00.000Z'),
  notes: [],
  occurrenceCount: 4,
  owner: null,
  ownerUserId: null,
  resolvedAt: null,
  runbook: null,
  runbookId: null,
  severity: OpsIncidentSeverity.WARNING,
  status: OpsWorkStatus.OPEN,
  summary: 'Four throttled flows detected.',
  team: null,
  title: 'Provider throttling · PIX',
  updatedAt: new Date('2026-08-02T11:00:00.000Z'),
  version: 1,
}

const caseRow = {
  createdAt: new Date('2026-08-02T09:00:00.000Z'),
  id: 'case-1',
  notes: [],
  owner: null,
  priority: OpsPriority.HIGH,
  status: OpsWorkStatus.OPEN,
  team: 'Support',
  transaction: {
    id: 'transaction-1',
    partnerUser: { partner: { name: 'Partner One' } },
    quote: { targetCurrency: 'BRL' },
    status: 'PROCESSING_PAYMENT',
  },
  updatedAt: new Date('2026-08-02T10:30:00.000Z'),
  version: 2,
}

const buildHarness = () => {
  const prisma = {
    opsCase: {
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => [caseRow]),
    },
    opsHandoff: { create: jest.fn(async () => ({ id: 'handoff-1' })) },
    opsIncident: {
      count: jest.fn(async () => 1),
      findMany: jest.fn(async () => [incidentRow]),
      findUnique: jest.fn(async () => incidentRow),
      groupBy: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    opsIncidentNote: { create: jest.fn(async () => ({ id: 'note-1' })) },
    opsRunbook: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    opsUser: {
      findFirst: jest.fn(async () => ({ role: OpsRole.OPERATIONS })),
      findMany: jest.fn(async () => []),
    },
  }
  const provider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  return {
    prisma,
    service: new OpsIncidentService(provider),
    transaction: prisma as unknown as Prisma.TransactionClient,
  }
}

describe('OpsIncidentService', () => {
  it('returns URL-filtered incident summaries with only allowlisted context', async () => {
    const harness = buildHarness()

    const result = await harness.service.list(principal, {
      severity: OpsIncidentSeverity.WARNING,
      status: OpsWorkStatus.OPEN,
      unowned: true,
    })

    expect(result.items[0]).toMatchObject({
      affectedCount: 3,
      context: {
        affected: [expect.objectContaining({ id: 'flow-1', type: 'FLOW' })],
      },
      id: 'incident-1',
    })
    expect(harness.prisma.opsIncident.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: null,
        severity: OpsIncidentSeverity.WARNING,
        status: OpsWorkStatus.OPEN,
      }),
    }))
  })

  it('orders shift work by operational urgency instead of enum spelling', async () => {
    const harness = buildHarness()

    const board = await harness.service.getHandoffBoard(principal)

    expect(board.items.map(item => item.resourceType)).toEqual(['CASE', 'INCIDENT'])
    expect(board.counts).toEqual({ mine: 2, total: 2, unowned: 2 })
  })

  it('records explicit team handoff and increments the incident version', async () => {
    const harness = buildHarness()

    await harness.service.handoff(principal, 'incident-1', {
      note: 'Provider escalation is active; verify queued retries before replay.',
      toTeam: 'Platform',
      toUserId: null,
    }, 1, harness.transaction)

    expect(harness.prisma.opsIncident.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ team: 'Platform', version: { increment: 1 } }),
      where: { id: 'incident-1', version: 1 },
    }))
    expect(harness.prisma.opsHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'ops-1',
        incidentId: 'incident-1',
        note: 'Provider escalation is active; verify queued retries before replay.',
        toTeam: 'Platform',
      }),
    })
  })
})
