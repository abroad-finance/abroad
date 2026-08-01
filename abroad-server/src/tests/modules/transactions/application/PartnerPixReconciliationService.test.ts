import 'reflect-metadata'

import type { Partner, PrismaClient } from '@prisma/client'

import { PartnerPortalRole, PartnerReconciliationItemStatus, PartnerReconciliationRunStatus } from '@prisma/client'

import { PartnerPortalAuditService } from '../../../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPixReconciliationNotFoundError, PartnerPixReconciliationService, PartnerPixReconciliationValidationError } from '../../../../modules/transactions/application/PartnerPixReconciliationService'
import { TransferoUltraClient, TransferoUltraError } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const now = new Date('2026-08-01T12:00:00.000Z')
const runId = '11111111-1111-4111-8111-111111111111'
const transactionId = '22222222-2222-4222-8222-222222222222'
const withdrawalId = '33333333-3333-4333-8333-333333333333'

type ReconciliationGroupRow = {
  _count: { _all: number }
  status: PartnerReconciliationItemStatus
}

type ReconciliationRunRecord = {
  batchSize: number
  completedAt: Date | null
  createdAt: Date
  failureCount: number
  id: string
  ineligibleCount: number
  items: Array<{
    failureCode: null | string
    status: PartnerReconciliationItemStatus
    transactionId: string
    updatedAt: Date
  }>
  processedCount: number
  status: PartnerReconciliationRunStatus
  unchangedCount: number
  updatedAt: Date
  updatedCount: number
}

const partner = {
  apiKey: null,
  clientDomain: null,
  clientDomainHash: null,
  country: 'US',
  createdAt: now,
  email: null,
  firstName: null,
  id: 'partner-1',
  isKybApproved: true,
  lastName: null,
  name: 'Decaf',
  needsKyc: false,
  phone: null,
  webhookUrl: 'https://decaf.example/webhook',
} satisfies Partner

const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'admin@decaf.example',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner,
  role: PartnerPortalRole.ADMIN,
  userId: 'portal-user-1',
}

const runRecord: ReconciliationRunRecord = {
  batchSize: 5,
  completedAt: now,
  createdAt: now,
  failureCount: 0,
  id: runId,
  ineligibleCount: 0,
  items: [{
    failureCode: null,
    status: PartnerReconciliationItemStatus.UPDATED,
    transactionId,
    updatedAt: now,
  }],
  processedCount: 1,
  status: PartnerReconciliationRunStatus.COMPLETED,
  unchangedCount: 0,
  updatedAt: now,
  updatedCount: 1,
}

const buildHarness = () => {
  const runCreate = jest.fn(async () => ({ id: runId }))
  const runFindFirst = jest.fn<Promise<null | ReconciliationRunRecord>, [unknown]>(async () => runRecord)
  const runFindMany = jest.fn<Promise<ReconciliationRunRecord[]>, [unknown]>(async () => [runRecord])
  const runFindUnique = jest.fn(async () => ({
    batchSize: 5,
    cursorCreatedAt: null,
    cursorTransactionId: null,
  }))
  const runUpdateMany = jest.fn(async () => ({ count: 1 }))
  const itemGroupBy = jest.fn<Promise<ReconciliationGroupRow[]>, [unknown]>(async () => [{
    _count: { _all: 1 },
    status: PartnerReconciliationItemStatus.UPDATED,
  }])
  const itemUpsert = jest.fn(async () => undefined)
  const transactionFindMany = jest.fn(async () => [{
    createdAt: now,
    externalId: withdrawalId,
    id: transactionId,
  }])
  const transactionFindUnique = jest.fn<Promise<{ pixEndToEndId: null | string }>, [unknown]>(
    async () => ({ pixEndToEndId: null }),
  )
  const transactionUpdateMany = jest.fn(async () => ({ count: 1 }))
  const executeTransaction = jest.fn<Promise<unknown>, [
    (client: unknown) => Promise<unknown>,
  ]>()
  const prisma = {
    $transaction: executeTransaction,
    partnerReconciliationItem: {
      groupBy: itemGroupBy,
      upsert: itemUpsert,
    },
    partnerReconciliationRun: {
      create: runCreate,
      findFirst: runFindFirst,
      findMany: runFindMany,
      findUnique: runFindUnique,
      updateMany: runUpdateMany,
    },
    transaction: {
      findMany: transactionFindMany,
      findUnique: transactionFindUnique,
      updateMany: transactionUpdateMany,
    },
  }
  executeTransaction.mockImplementation(async callback => callback(prisma))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  const transferoGet = jest.fn<Promise<unknown>, [string, unknown?]>(async () => ({
    endToEndId: 'E47133056202607301830abcdef54321',
    id: withdrawalId,
    status: 'SETTLED',
  }))
  const auditRecord = jest.fn(async () => undefined)
  const service = new PartnerPixReconciliationService(
    databaseClientProvider,
    { get: transferoGet } as unknown as TransferoUltraClient,
    { record: auditRecord } as unknown as PartnerPortalAuditService,
  )
  return {
    auditRecord,
    itemGroupBy,
    itemUpsert,
    runFindFirst,
    runFindMany,
    runUpdateMany,
    service,
    transactionFindMany,
    transactionFindUnique,
    transactionUpdateMany,
    transferoGet,
  }
}

describe('PartnerPixReconciliationService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('starts an audited run and compare-before-writes a settled Ultra PIX E2E ID', async () => {
    const harness = buildHarness()

    const result = await harness.service.start(principal, 5)

    expect(result).toEqual(runRecord)
    expect(harness.transactionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 6,
      where: expect.objectContaining({
        createdAt: { gte: new Date('2026-07-28T15:35:27.000Z') },
        externalId: { not: null },
        partnerUser: { partnerId: partner.id },
        pixEndToEndId: null,
        quote: { paymentMethod: 'PIX' },
      }),
    }))
    expect(harness.transferoGet).toHaveBeenCalledWith(
      `/api/v1/pix/withdrawals/${withdrawalId}`,
    )
    expect(harness.transactionUpdateMany).toHaveBeenCalledWith({
      data: { pixEndToEndId: 'E47133056202607301830abcdef54321' },
      where: { id: transactionId, pixEndToEndId: null },
    })
    expect(harness.itemUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        failureCode: null,
        status: PartnerReconciliationItemStatus.UPDATED,
        transactionId,
      }),
    }))
    expect(harness.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'pix_reconciliation.started',
      partnerId: partner.id,
    }), expect.anything())
    expect(harness.auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'pix_reconciliation.completed',
      metadata: { failureCount: 0, processedCount: 1 },
    }), expect.anything())
  })

  it('rejects invalid batch sizes before creating or calling the provider', async () => {
    const harness = buildHarness()

    await expect(harness.service.start(principal, 0)).rejects.toThrow(
      new PartnerPixReconciliationValidationError('Batch size must be between 1 and 5'),
    )
    await expect(harness.service.start(principal, 6)).rejects.toThrow(
      new PartnerPixReconciliationValidationError('Batch size must be between 1 and 5'),
    )
    expect(harness.transferoGet).not.toHaveBeenCalled()
  })

  it('keeps tenant ownership on run listing', async () => {
    const harness = buildHarness()

    await expect(harness.service.list(partner.id)).resolves.toEqual({ items: [runRecord] })
    expect(harness.runFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 20,
      where: { partnerId: partner.id },
    }))
  })

  it('does not call Ultra when the run belongs to another tenant', async () => {
    const harness = buildHarness()
    harness.runUpdateMany.mockResolvedValueOnce({ count: 0 })
    harness.runFindFirst.mockResolvedValueOnce(null)

    await expect(harness.service.continue(principal, runId)).rejects.toThrow(
      new PartnerPixReconciliationNotFoundError(),
    )
    expect(harness.transferoGet).not.toHaveBeenCalled()
  })

  it('rejects a concurrent lease and a completed run without provider reads', async () => {
    const harness = buildHarness()
    harness.runUpdateMany.mockResolvedValueOnce({ count: 0 })
    harness.runFindFirst.mockResolvedValueOnce({
      ...runRecord,
      status: PartnerReconciliationRunStatus.RUNNING,
    })
    await expect(harness.service.continue(principal, runId)).rejects.toThrow(
      new PartnerPixReconciliationValidationError('This reconciliation run is already processing'),
    )

    harness.runUpdateMany.mockResolvedValueOnce({ count: 0 })
    harness.runFindFirst.mockResolvedValueOnce(runRecord)
    await expect(harness.service.continue(principal, runId)).rejects.toThrow(
      new PartnerPixReconciliationValidationError('This reconciliation run is complete'),
    )
    expect(harness.transferoGet).not.toHaveBeenCalled()
  })

  it('records missing/invalid provider records as safe item outcomes without transaction writes', async () => {
    const harness = buildHarness()
    harness.transferoGet.mockRejectedValueOnce(new TransferoUltraError({
      code: 'validation',
      message: 'provider detail',
      status: 404,
    }))
    harness.itemGroupBy.mockResolvedValueOnce([{ _count: { _all: 1 }, status: PartnerReconciliationItemStatus.INELIGIBLE }])
    harness.runFindFirst.mockResolvedValueOnce({
      ...runRecord,
      ineligibleCount: 1,
      items: [{
        failureCode: 'PROVIDER_RECORD_NOT_FOUND',
        status: PartnerReconciliationItemStatus.INELIGIBLE,
        transactionId,
        updatedAt: now,
      }],
      updatedCount: 0,
    })

    await harness.service.continue(principal, runId)

    expect(harness.itemUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        failureCode: 'PROVIDER_RECORD_NOT_FOUND',
        status: PartnerReconciliationItemStatus.INELIGIBLE,
      }),
    }))
    expect(harness.transactionUpdateMany).not.toHaveBeenCalled()
  })

  it('preserves a concurrently persisted matching E2E and flags a conflicting value', async () => {
    const matching = buildHarness()
    matching.transactionUpdateMany.mockResolvedValueOnce({ count: 0 })
    matching.transactionFindUnique.mockResolvedValueOnce({
      pixEndToEndId: 'E47133056202607301830abcdef54321',
    })

    await matching.service.continue(principal, runId)
    expect(matching.itemUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        failureCode: null,
        status: PartnerReconciliationItemStatus.UNCHANGED,
      }),
    }))

    const conflicting = buildHarness()
    conflicting.transactionUpdateMany.mockResolvedValueOnce({ count: 0 })
    conflicting.transactionFindUnique.mockResolvedValueOnce({ pixEndToEndId: 'E-different' })
    conflicting.itemGroupBy.mockResolvedValueOnce([{ _count: { _all: 1 }, status: PartnerReconciliationItemStatus.FAILED }])

    await conflicting.service.continue(principal, runId)
    expect(conflicting.itemUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        failureCode: 'E2E_CONFLICT',
        status: PartnerReconciliationItemStatus.FAILED,
      }),
    }))
  })

  it('processes only one bounded page and leaves the run resumable when more candidates exist', async () => {
    const harness = buildHarness()
    harness.transactionFindMany.mockResolvedValueOnce(Array.from({ length: 6 }, (_, index) => ({
      createdAt: new Date(now.getTime() + index),
      externalId: `${index + 1}`.padStart(8, '0') + '-3333-4333-8333-333333333333',
      id: `${index + 1}`.padStart(8, '0') + '-2222-4222-8222-222222222222',
    })))
    harness.transferoGet.mockImplementation(async (path: string) => ({
      endToEndId: `E${path.slice(-36).replaceAll('-', '')}`,
      id: path.slice(-36),
      status: 'SETTLED',
    }))

    await harness.service.continue(principal, runId)

    expect(harness.transferoGet).toHaveBeenCalledTimes(5)
    expect(harness.runUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        completedAt: null,
        status: PartnerReconciliationRunStatus.RUNNING,
      }),
    }))
    expect(harness.auditRecord).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'pix_reconciliation.completed',
    }))
  })
})
