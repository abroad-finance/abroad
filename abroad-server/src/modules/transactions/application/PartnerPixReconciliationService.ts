import { PartnerReconciliationItemStatus, PartnerReconciliationRunStatus, PaymentMethod, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from '../../partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../partners/application/PartnerPortalSessionService'
import { TransferoUltraClient, TransferoUltraError } from '../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraWithdrawalDetailResponseSchema } from '../../transfero/infrastructure/transferoUltraSchemas'

const DEFAULT_BATCH_SIZE = 5
const MAX_BATCH_SIZE = 5
const MIN_BATCH_SIZE = 1
const RECONCILIATION_LEASE_MS = 2 * 60 * 1_000
const ULTRA_PRODUCTION_CUTOVER_AT = new Date('2026-07-28T15:35:27.000Z')
/**
 * How long Ultra gets to become consistent about a withdrawal id it just
 * issued. Inside this window a 404 is read-after-write lag; outside it the
 * record does not exist and never will.
 */
const PROVIDER_RECORD_SETTLING_WINDOW_MS = 60 * 60 * 1_000

const providerWithdrawalIdSchema = z.string().uuid()

export type PartnerPixReconciliationItemDto = {
  failureCode: null | string
  status: PartnerReconciliationItemStatus
  transactionId: string
  updatedAt: Date
}

export type PartnerPixReconciliationRunDto = {
  batchSize: number
  completedAt: Date | null
  createdAt: Date
  failureCount: number
  id: string
  ineligibleCount: number
  items: PartnerPixReconciliationItemDto[]
  processedCount: number
  status: PartnerReconciliationRunStatus
  unchangedCount: number
  updatedAt: Date
  updatedCount: number
}

export type PartnerPixReconciliationRunList = {
  items: PartnerPixReconciliationRunDto[]
}

type ReconciliationFailureCode
  = | 'E2E_CONFLICT'
    | 'E2E_MISSING'
    | 'INVALID_PROVIDER_RESPONSE'
    | 'INVALID_WITHDRAWAL_ID'
    | 'PROVIDER_RECORD_NOT_FOUND'
    | 'PROVIDER_RECORD_PENDING'
    | 'PROVIDER_UNAVAILABLE'
    | 'WITHDRAWAL_NOT_SETTLED'

/**
 * Outcomes no later sweep can change: a non-UUID `externalId` is never
 * rewritten, and a withdrawal id Ultra disowns past its settling window stays
 * disowned. Recording one retires the candidate for good — every other
 * ineligible outcome (an unsettled withdrawal, a 404 still inside the window)
 * stays in scope so a later run can still resolve it.
 */
const TERMINAL_INELIGIBLE_FAILURE_CODES: ReconciliationFailureCode[] = [
  'INVALID_WITHDRAWAL_ID',
  'PROVIDER_RECORD_NOT_FOUND',
]

type ReconciliationOutcome = {
  failureCode: null | ReconciliationFailureCode
  status: PartnerReconciliationItemStatus
}

export class PartnerPixReconciliationNotFoundError extends Error {
  public constructor() {
    super('Reconciliation run not found')
    this.name = 'PartnerPixReconciliationNotFoundError'
  }
}

export class PartnerPixReconciliationValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerPixReconciliationValidationError'
  }
}

@injectable()
export class PartnerPixReconciliationService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TransferoUltraClient)
    private readonly transferoUltraClient: TransferoUltraClient,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
  ) {}

  public async continue(
    principal: PartnerPortalPrincipal,
    runId: string,
  ): Promise<PartnerPixReconciliationRunDto> {
    return this.processBatch(principal, runId)
  }

  public async list(partnerId: string): Promise<PartnerPixReconciliationRunList> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const runs = await prismaClient.partnerReconciliationRun.findMany({
      include: {
        items: {
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 50,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      where: { partnerId },
    })
    return { items: runs.map(run => this.toDto(run)) }
  }

  public async start(
    principal: PartnerPortalPrincipal,
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<PartnerPixReconciliationRunDto> {
    if (!Number.isSafeInteger(batchSize) || batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
      throw new PartnerPixReconciliationValidationError(
        `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}`,
      )
    }
    const prismaClient = await this.databaseClientProvider.getClient()
    const run = await prismaClient.$transaction(async (transaction) => {
      const created = await transaction.partnerReconciliationRun.create({
        data: {
          batchSize,
          initiatedByPortalUserId: principal.userId,
          partnerId: principal.partner.id,
        },
      })
      await this.auditService.record({
        action: 'pix_reconciliation.started',
        actorUserId: principal.userId,
        metadata: { batchSize },
        partnerId: principal.partner.id,
        resourceId: created.id,
        resourceType: 'pix_reconciliation',
      }, transaction)
      return created
    })
    return this.processBatch(principal, run.id)
  }

  private async claimRun(
    partnerId: string,
    runId: string,
  ): Promise<{ batchSize: number, cursorCreatedAt: Date | null, cursorTransactionId: null | string, leaseToken: string }> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const now = new Date()
    const leaseToken = randomUUID()
    const claimed = await prismaClient.partnerReconciliationRun.updateMany({
      data: {
        leaseExpiresAt: new Date(now.getTime() + RECONCILIATION_LEASE_MS),
        leaseToken,
      },
      where: {
        id: runId,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
        ],
        partnerId,
        status: PartnerReconciliationRunStatus.RUNNING,
      },
    })
    if (claimed.count === 0) {
      const existing = await prismaClient.partnerReconciliationRun.findFirst({
        select: { status: true },
        where: { id: runId, partnerId },
      })
      if (!existing) {
        throw new PartnerPixReconciliationNotFoundError()
      }
      if (existing.status !== PartnerReconciliationRunStatus.RUNNING) {
        throw new PartnerPixReconciliationValidationError('This reconciliation run is complete')
      }
      throw new PartnerPixReconciliationValidationError(
        'This reconciliation run is already processing',
      )
    }
    const run = await prismaClient.partnerReconciliationRun.findUnique({
      select: {
        batchSize: true,
        cursorCreatedAt: true,
        cursorTransactionId: true,
      },
      where: { id: runId },
    })
    if (!run) {
      throw new PartnerPixReconciliationNotFoundError()
    }
    return { ...run, leaseToken }
  }

  private async finalizeBatch(params: {
    hasMore: boolean
    lastCreatedAt: Date | null
    lastTransactionId: null | string
    leaseToken: string
    principal: PartnerPortalPrincipal
    runId: string
  }): Promise<PartnerPixReconciliationRunDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.$transaction(async (transaction) => {
      const grouped = await transaction.partnerReconciliationItem.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: { runId: params.runId },
      })
      const counts = new Map(grouped.map(group => [group.status, group._count._all]))
      const failureCount = counts.get(PartnerReconciliationItemStatus.FAILED) ?? 0
      const nextStatus = params.hasMore
        ? PartnerReconciliationRunStatus.RUNNING
        : failureCount > 0
          ? PartnerReconciliationRunStatus.COMPLETED_WITH_ERRORS
          : PartnerReconciliationRunStatus.COMPLETED
      const processedCount = grouped.reduce((total, group) => total + group._count._all, 0)
      const completedAt = params.hasMore ? null : new Date()
      const updated = await transaction.partnerReconciliationRun.updateMany({
        data: {
          completedAt,
          cursorCreatedAt: params.lastCreatedAt,
          cursorTransactionId: params.lastTransactionId,
          failureCount,
          ineligibleCount: counts.get(PartnerReconciliationItemStatus.INELIGIBLE) ?? 0,
          leaseExpiresAt: null,
          leaseToken: null,
          processedCount,
          status: nextStatus,
          unchangedCount: counts.get(PartnerReconciliationItemStatus.UNCHANGED) ?? 0,
          updatedCount: counts.get(PartnerReconciliationItemStatus.UPDATED) ?? 0,
        },
        where: { id: params.runId, leaseToken: params.leaseToken },
      })
      if (updated.count !== 1) {
        throw new PartnerPixReconciliationValidationError('The reconciliation lease expired')
      }
      if (!params.hasMore) {
        await this.auditService.record({
          action: 'pix_reconciliation.completed',
          actorUserId: params.principal.userId,
          metadata: { failureCount, processedCount },
          partnerId: params.principal.partner.id,
          resourceId: params.runId,
          resourceType: 'pix_reconciliation',
        }, transaction)
      }
    })
    return this.readRun(params.principal.partner.id, params.runId)
  }

  private async findCandidates(params: {
    batchSize: number
    cursorCreatedAt: Date | null
    cursorTransactionId: null | string
    partnerId: string
  }): Promise<Array<{ createdAt: Date, externalId: null | string, id: string }>> {
    const cursorFilter: Prisma.TransactionWhereInput = params.cursorCreatedAt
      ? {
          OR: [
            { createdAt: { gt: params.cursorCreatedAt } },
            {
              createdAt: params.cursorCreatedAt,
              id: { gt: params.cursorTransactionId ?? '' },
            },
          ],
        }
      : {}
    const prismaClient = await this.databaseClientProvider.getClient()
    return prismaClient.transaction.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true, externalId: true, id: true },
      take: params.batchSize + 1,
      where: {
        ...cursorFilter,
        createdAt: {
          ...(cursorFilter.createdAt && typeof cursorFilter.createdAt === 'object'
            ? cursorFilter.createdAt
            : {}),
          gte: ULTRA_PRODUCTION_CUTOVER_AT,
        },
        externalId: { not: null },
        partnerUser: { partnerId: params.partnerId },
        pixEndToEndId: null,
        quote: { paymentMethod: PaymentMethod.PIX },
        // A candidate already proven unresolvable never becomes resolvable, so
        // it must not consume a batch slot or an Ultra call again. Without this
        // every run re-walked the same dead ids from the cutover date: ~1166
        // withdrawals Ultra will never know, re-read >1000 times in 48h,
        // burning quota that Transfero meters account-wide and that
        // customer-facing calls therefore have to share.
        reconciliationItems: { none: { failureCode: { in: TERMINAL_INELIGIBLE_FAILURE_CODES } } },
      },
    })
  }

  private async processBatch(
    principal: PartnerPortalPrincipal,
    runId: string,
  ): Promise<PartnerPixReconciliationRunDto> {
    const run = await this.claimRun(principal.partner.id, runId)
    try {
      const candidates = await this.findCandidates({
        batchSize: run.batchSize,
        cursorCreatedAt: run.cursorCreatedAt,
        cursorTransactionId: run.cursorTransactionId,
        partnerId: principal.partner.id,
      })
      const hasMore = candidates.length > run.batchSize
      const batch = candidates.slice(0, run.batchSize)
      for (const candidate of batch) {
        const outcome = await this.reconcileCandidate(candidate)
        await this.recordOutcome(runId, candidate.id, outcome)
      }
      const last = batch.at(-1)
      return await this.finalizeBatch({
        hasMore,
        lastCreatedAt: last?.createdAt ?? run.cursorCreatedAt,
        lastTransactionId: last?.id ?? run.cursorTransactionId,
        leaseToken: run.leaseToken,
        principal,
        runId,
      })
    }
    catch (error) {
      const prismaClient = await this.databaseClientProvider.getClient()
      await prismaClient.partnerReconciliationRun.updateMany({
        data: { leaseExpiresAt: null, leaseToken: null },
        where: { id: runId, leaseToken: run.leaseToken },
      })
      throw error
    }
  }

  private async readRun(
    partnerId: string,
    runId: string,
  ): Promise<PartnerPixReconciliationRunDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const run = await prismaClient.partnerReconciliationRun.findFirst({
      include: {
        items: {
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 50,
        },
      },
      where: { id: runId, partnerId },
    })
    if (!run) {
      throw new PartnerPixReconciliationNotFoundError()
    }
    return this.toDto(run)
  }

  private async reconcileCandidate(candidate: {
    createdAt: Date
    externalId: null | string
    id: string
  }): Promise<ReconciliationOutcome> {
    const withdrawalId = providerWithdrawalIdSchema.safeParse(candidate.externalId)
    if (!withdrawalId.success) {
      return { failureCode: 'INVALID_WITHDRAWAL_ID', status: PartnerReconciliationItemStatus.INELIGIBLE }
    }
    let rawDetail: unknown
    try {
      rawDetail = await this.transferoUltraClient.get(
        `/api/v1/pix/withdrawals/${withdrawalId.data}`,
      )
    }
    catch (error) {
      if (error instanceof TransferoUltraError && error.status === 404) {
        // Ultra mints the withdrawal id when it accepts the payout, so once it
        // has had time to become consistent a 404 on an id we already stored is
        // permanent. Retiring the candidate only past that window keeps a
        // freshly created withdrawal from being stranded by replication lag.
        const settled = Date.now() - candidate.createdAt.getTime() >= PROVIDER_RECORD_SETTLING_WINDOW_MS
        return {
          failureCode: settled ? 'PROVIDER_RECORD_NOT_FOUND' : 'PROVIDER_RECORD_PENDING',
          status: PartnerReconciliationItemStatus.INELIGIBLE,
        }
      }
      return { failureCode: 'PROVIDER_UNAVAILABLE', status: PartnerReconciliationItemStatus.FAILED }
    }
    const detail = transferoUltraWithdrawalDetailResponseSchema.safeParse(rawDetail)
    if (!detail.success || detail.data.id !== withdrawalId.data) {
      return { failureCode: 'INVALID_PROVIDER_RESPONSE', status: PartnerReconciliationItemStatus.FAILED }
    }
    if (detail.data.status !== 'SETTLED') {
      return { failureCode: 'WITHDRAWAL_NOT_SETTLED', status: PartnerReconciliationItemStatus.INELIGIBLE }
    }
    if (!detail.data.endToEndId) {
      return { failureCode: 'E2E_MISSING', status: PartnerReconciliationItemStatus.FAILED }
    }

    const prismaClient = await this.databaseClientProvider.getClient()
    try {
      const updated = await prismaClient.transaction.updateMany({
        data: { pixEndToEndId: detail.data.endToEndId },
        where: { id: candidate.id, pixEndToEndId: null },
      })
      if (updated.count === 1) {
        return { failureCode: null, status: PartnerReconciliationItemStatus.UPDATED }
      }
    }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error
      }
    }
    const current = await prismaClient.transaction.findUnique({
      select: { pixEndToEndId: true },
      where: { id: candidate.id },
    })
    if (current?.pixEndToEndId === detail.data.endToEndId) {
      return { failureCode: null, status: PartnerReconciliationItemStatus.UNCHANGED }
    }
    return { failureCode: 'E2E_CONFLICT', status: PartnerReconciliationItemStatus.FAILED }
  }

  private async recordOutcome(
    runId: string,
    transactionId: string,
    outcome: ReconciliationOutcome,
  ): Promise<void> {
    const prismaClient = await this.databaseClientProvider.getClient()
    await prismaClient.partnerReconciliationItem.upsert({
      create: {
        failureCode: outcome.failureCode,
        runId,
        status: outcome.status,
        transactionId,
      },
      update: {
        failureCode: outcome.failureCode,
        status: outcome.status,
      },
      where: { runId_transactionId: { runId, transactionId } },
    })
  }

  private toDto(run: {
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
  }): PartnerPixReconciliationRunDto {
    return {
      batchSize: run.batchSize,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
      failureCount: run.failureCount,
      id: run.id,
      ineligibleCount: run.ineligibleCount,
      items: run.items.map(item => ({
        failureCode: item.failureCode,
        status: item.status,
        transactionId: item.transactionId,
        updatedAt: item.updatedAt,
      })),
      processedCount: run.processedCount,
      status: run.status,
      unchangedCount: run.unchangedCount,
      updatedAt: run.updatedAt,
      updatedCount: run.updatedCount,
    }
  }
}
