import { BridgeBatchStatus, BridgeLegStatus, CryptoCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { BridgeFloatService } from './BridgeFloatService'

export type OpsBridgeBatchDto = {
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
}

export type OpsBridgeFloatDto = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
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
    total: number
  }
}

const BATCH_BOARD_LIMIT = 25

// Legs whose USDC is fronted by the float but not yet bridged back.
const OUTSTANDING_LEG_STATUSES: BridgeLegStatus[] = [BridgeLegStatus.BATCHED, BridgeLegStatus.PENDING]

/**
 * Read model for the bridge ops surface: the float deficit-vs-cap gauge, the
 * pending-leg breakdown, and the batch lifecycle board. Pure aggregation — no
 * mutations — so it is safe to poll from the ops dashboard.
 */
@injectable()
export class OpsBridgeService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(BridgeFloatService) private readonly floatService: BridgeFloatService,
  ) {}

  public async getOverview(): Promise<OpsBridgeOverview> {
    const client = await this.dbProvider.getClient()

    const [groups, oldestPending, batches] = await Promise.all([
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

    return {
      batches: batches.map(batch => ({
        asset: batch.asset,
        createdAt: batch.createdAt,
        destNetwork: batch.destNetwork,
        grossAmount: batch.grossAmount,
        id: batch.id,
        memberCount: batch._count.members,
        settledAt: batch.settledAt,
        status: batch.status,
        withdrawFee: batch.withdrawFee,
        withdrawId: batch.withdrawId,
      })),
      float: { available, cap, deficit, enabled },
      legs: {
        byStatus,
        oldestPendingAt: oldestPending?.createdAt ?? null,
        total,
      },
    }
  }
}
