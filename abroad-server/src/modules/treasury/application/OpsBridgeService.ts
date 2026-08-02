import { BridgeBatchStatus, BridgeLegStatus, CryptoCurrency, type PrismaClient } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { BridgeFloatService } from './BridgeFloatService'

export type OpsBridgeBatchDetailDto = {
  batch: OpsBridgeBatchDto
  members: OpsBridgeLegDto[]
  providerReference: null | string
}

export type OpsBridgeBatchDto = {
  asset: CryptoCurrency
  createdAt: Date
  destNetwork: string
  expectedSlaAt: Date
  failureCategory: 'BRIDGE_PROVIDER_FAILURE' | null
  grossAmount: number
  id: string
  incidentPath: string
  memberCount: number
  reconciliationState: OpsBridgeReconciliationState
  runbookPath: string
  settledAt: Date | null
  slaState: OpsBridgeSlaState
  status: BridgeBatchStatus
  withdrawFee: null | number
  withdrawId: null | string
}

export type OpsBridgeFloatDto = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
}

export type OpsBridgeLegDto = {
  amount: number
  asset: CryptoCurrency
  batchId: null | string
  createdAt: Date
  destNetwork: string
  expectedSlaAt: Date
  failureCategory: 'BRIDGE_LEG_FAILED' | null
  id: string
  incidentPath: string
  reconciliationState: OpsBridgeReconciliationState
  slaState: OpsBridgeSlaState
  status: BridgeLegStatus
  transaction: null | {
    id: string
    partner: { id: string, name: string }
    status: string
  }
  updatedAt: Date
}

export type OpsBridgeLegGroupDto = {
  amount: number
  count: number
  status: BridgeLegStatus
}

export type OpsBridgeOverview = {
  batches: OpsBridgeBatchDto[]
  float: OpsBridgeFloatDto
  legs: {
    byStatus: OpsBridgeLegGroupDto[]
    oldestPendingAt: Date | null
    recent: OpsBridgeLegDto[]
    total: number
  }
}

export type OpsBridgeReconciliationState = 'ACTION_REQUIRED' | 'AWAITING_PROVIDER' | 'COLLECTING' | 'RECONCILED'

export type OpsBridgeSlaState = 'BREACHED' | 'MET' | 'ON_TRACK'

const BATCH_BOARD_LIMIT = 25
const LEG_BOARD_LIMIT = 50
const DEFAULT_PENDING_SLA_MS = 60 * 60 * 1_000
const DEFAULT_SUBMITTED_SLA_MS = 2 * 60 * 60 * 1_000

// Legs whose USDC is fronted by the float but not yet bridged back.
const OUTSTANDING_LEG_STATUSES: BridgeLegStatus[] = [BridgeLegStatus.BATCHED, BridgeLegStatus.PENDING]

/**
 * Read model for the bridge ops surface: the float deficit-vs-cap gauge, the
 * pending-leg breakdown, and the batch lifecycle board. Pure aggregation — no
 * mutations — so it is safe to poll from the ops dashboard.
 */
@injectable()
export class OpsBridgeService {
  private readonly pendingSlaMs: number
  private readonly submittedSlaMs: number

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(BridgeFloatService) private readonly floatService: BridgeFloatService,
  ) {
    this.pendingSlaMs = this.readNumber('BRIDGE_PENDING_SLA_MS', DEFAULT_PENDING_SLA_MS)
    this.submittedSlaMs = this.readNumber('BRIDGE_SUBMITTED_SLA_MS', DEFAULT_SUBMITTED_SLA_MS)
  }

  public async getBatchDetail(batchId: string): Promise<OpsBridgeBatchDetailDto> {
    const client = await this.dbProvider.getClient()
    const batch = await client.bridgeBatch.findUnique({
      include: { members: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      where: { id: batchId },
    })
    if (!batch) throw new ApplicationError(404, 'ops_bridge_batch_not_found', 'Bridge batch not found')
    const now = new Date()
    return {
      batch: this.toBatchDto({ ...batch, memberCount: batch.members.length }, now),
      members: await this.toLegDtos(client, batch.members, now),
      providerReference: batch.withdrawId,
    }
  }

  public async getOverview(): Promise<OpsBridgeOverview> {
    const client = await this.dbProvider.getClient()

    const [groups, oldestPending, batches, recentLegs] = await Promise.all([
      client.bridgePendingTransfer.groupBy({
        _count: { _all: true },
        _sum: { amount: true },
        by: ['status'],
      }),
      client.bridgePendingTransfer.findFirst({
        orderBy: { createdAt: 'asc' },
        where: { status: BridgeLegStatus.PENDING },
      }),
      client.bridgeBatch.findMany({
        include: { _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' },
        take: BATCH_BOARD_LIMIT,
      }),
      client.bridgePendingTransfer.findMany({
        orderBy: { updatedAt: 'desc' },
        take: LEG_BOARD_LIMIT,
      }),
    ])

    const byStatus: OpsBridgeLegGroupDto[] = groups.map(group => ({
      amount: Number(group._sum?.amount ?? 0) || 0,
      count: group._count._all,
      status: group.status,
    }))

    const total = byStatus.reduce((sum, group) => sum + group.count, 0)
    const deficit = byStatus
      .filter(group => OUTSTANDING_LEG_STATUSES.includes(group.status))
      .reduce((sum, group) => sum + group.amount, 0)

    const cap = this.floatService.getCapUsdc() ?? null
    const enabled = cap !== null
    const available = cap !== null ? cap - deficit : null

    const now = new Date()
    return {
      batches: batches.map(batch => this.toBatchDto({ ...batch, memberCount: batch._count.members }, now)),
      float: { available, cap, deficit, enabled },
      legs: {
        byStatus,
        oldestPendingAt: oldestPending?.createdAt ?? null,
        recent: await this.toLegDtos(client, recentLegs, now),
        total,
      },
    }
  }

  private batchReconciliationState(status: BridgeBatchStatus): OpsBridgeReconciliationState {
    switch (status) {
      case BridgeBatchStatus.CREDITED: return 'RECONCILED'
      case BridgeBatchStatus.FAILED: return 'ACTION_REQUIRED'
      case BridgeBatchStatus.OPEN: return 'COLLECTING'
      case BridgeBatchStatus.SUBMITTED: return 'AWAITING_PROVIDER'
    }
  }

  private batchSlaState(
    status: BridgeBatchStatus,
    expectedSlaAt: Date,
    settledAt: Date | null,
    now: Date,
  ): OpsBridgeSlaState {
    if (settledAt) return settledAt <= expectedSlaAt ? 'MET' : 'BREACHED'
    if (status === BridgeBatchStatus.FAILED || now > expectedSlaAt) return 'BREACHED'
    return 'ON_TRACK'
  }

  private legReconciliationState(status: BridgeLegStatus): OpsBridgeReconciliationState {
    switch (status) {
      case BridgeLegStatus.BATCHED: return 'AWAITING_PROVIDER'
      case BridgeLegStatus.FAILED: return 'ACTION_REQUIRED'
      case BridgeLegStatus.PENDING: return 'COLLECTING'
      case BridgeLegStatus.SETTLED: return 'RECONCILED'
    }
  }

  private readNumber(key: string, fallback: number): number {
    const value = Number(process.env[key])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  private toBatchDto(
    batch: {
      asset: CryptoCurrency
      createdAt: Date
      destNetwork: string
      grossAmount: number
      id: string
      memberCount: number
      settledAt: Date | null
      status: BridgeBatchStatus
      withdrawFee: null | number
      withdrawId: null | string
    },
    now: Date,
  ): OpsBridgeBatchDto {
    const expectedSlaAt = new Date(batch.createdAt.getTime() + this.submittedSlaMs)
    return {
      asset: batch.asset,
      createdAt: batch.createdAt,
      destNetwork: batch.destNetwork,
      expectedSlaAt,
      failureCategory: batch.status === BridgeBatchStatus.FAILED ? 'BRIDGE_PROVIDER_FAILURE' : null,
      grossAmount: batch.grossAmount,
      id: batch.id,
      incidentPath: `/ops/incidents?kind=BRIDGE&query=${encodeURIComponent(batch.id)}`,
      memberCount: batch.memberCount,
      reconciliationState: this.batchReconciliationState(batch.status),
      runbookPath: '/ops/administration/integrations?kind=RUNBOOK&incidentKind=BRIDGE',
      settledAt: batch.settledAt,
      slaState: this.batchSlaState(batch.status, expectedSlaAt, batch.settledAt, now),
      status: batch.status,
      withdrawFee: batch.withdrawFee,
      withdrawId: batch.withdrawId,
    }
  }

  private async toLegDtos(
    client: PrismaClient,
    legs: Array<{
      amount: number
      asset: CryptoCurrency
      batchId: null | string
      createdAt: Date
      destNetwork: string
      id: string
      status: BridgeLegStatus
      transactionId: string
      updatedAt: Date
    }>,
    now: Date,
  ): Promise<OpsBridgeLegDto[]> {
    const transactionIds = [...new Set(legs.map(leg => leg.transactionId))]
    const transactions = transactionIds.length > 0
      ? await client.transaction.findMany({
          select: {
            id: true,
            partnerUser: { select: { partner: { select: { id: true, name: true } } } },
            status: true,
          },
          where: { id: { in: transactionIds } },
        })
      : []
    const transactionById = new Map(transactions.map(transaction => [transaction.id, transaction]))
    return legs.map((leg) => {
      const expectedSlaAt = new Date(leg.createdAt.getTime() + this.pendingSlaMs)
      const transaction = transactionById.get(leg.transactionId)
      const completed = leg.status === BridgeLegStatus.SETTLED
      const breached = leg.status === BridgeLegStatus.FAILED || (!completed && now > expectedSlaAt)
      return {
        amount: leg.amount,
        asset: leg.asset,
        batchId: leg.batchId,
        createdAt: leg.createdAt,
        destNetwork: leg.destNetwork,
        expectedSlaAt,
        failureCategory: leg.status === BridgeLegStatus.FAILED ? 'BRIDGE_LEG_FAILED' : null,
        id: leg.id,
        incidentPath: `/ops/incidents?kind=BRIDGE&query=${encodeURIComponent(leg.id)}`,
        reconciliationState: this.legReconciliationState(leg.status),
        slaState: completed ? 'MET' : breached ? 'BREACHED' : 'ON_TRACK',
        status: leg.status,
        transaction: transaction
          ? {
              id: transaction.id,
              partner: transaction.partnerUser.partner,
              status: transaction.status,
            }
          : null,
        updatedAt: leg.updatedAt,
      }
    })
  }
}
