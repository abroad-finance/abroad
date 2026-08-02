import {
  BridgeLegStatus,
  CryptoCurrency,
  FlowInstanceStatus,
  Prisma,
  type PrismaClient,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { OpsBridgeOverview, OpsBridgeService } from '../../treasury/application/OpsBridgeService'
import { OpsTreasuryBalancesResponse, OpsTreasuryService } from '../../treasury/application/OpsTreasuryService'
import { OpsIncidentOverviewDto, OpsIncidentService } from './OpsIncidentService'

export type OpsOverviewRange = '7d' | '24h' | '30d'

export type OpsOverviewResponse = {
  activity: OpsOverviewActivity
  bridge: OpsOverviewBridge
  execution: OpsOverviewExecution
  generatedAt: Date
  incidents: OpsIncidentOverviewDto
  partners: OpsOverviewPartners
  treasury: OpsOverviewTreasury
  window: OpsOverviewWindow
}

type ActivityPeriod = 'CURRENT' | 'PREVIOUS'

type ActivityRow = {
  bucket: Date
  cryptoCurrency: CryptoCurrency
  payoutAmount: number
  period: ActivityPeriod
  sourceAmount: number
  status: TransactionStatus
  targetCurrency: TargetCurrency
  transactionCount: number
}

type ActivitySummaryAccumulator = {
  payoutVolume: Map<TargetCurrency, number>
  sourceVolume: Map<CryptoCurrency, number>
  statusCounts: Map<TransactionStatus, number>
}

type FlowStatusRow = {
  _count: { _all: number }
  status: FlowInstanceStatus
}

type OpsOverviewActivity = {
  current: OpsOverviewActivitySummary
  previous: OpsOverviewActivitySummary
  series: OpsOverviewActivityPoint[]
  seriesUnit: OpsOverviewSeriesUnit
}

type OpsOverviewActivityPoint = {
  at: Date
  completedTransactions: number
  expiredTransactions: number
  failedTransactions: number
  openTransactions: number
  totalTransactions: number
}

type OpsOverviewActivitySummary = {
  completedTransactions: number
  payoutVolume: OpsOverviewPayoutVolume[]
  sourceVolume: OpsOverviewSourceVolume[]
  statusCounts: OpsOverviewTransactionStatusCount[]
  successRatePct: null | number
  totalTransactions: number
}

type OpsOverviewBridge = {
  failedLegs: OpsOverviewBridgeLegSummary
  float: OpsOverviewBridgeFloat
  oldestPendingAt: Date | null
  outstandingLegs: OpsOverviewBridgeLegSummary
}

type OpsOverviewBridgeFloat = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
}

type OpsOverviewBridgeLegSummary = {
  amount: number
  count: number
}

type OpsOverviewExecution = {
  oldestWaitingAt: Date | null
  statusCounts: OpsOverviewFlowStatusCount[]
  totalFlows: number
}

type OpsOverviewFlowStatusCount = {
  count: number
  status: FlowInstanceStatus
}

type OpsOverviewPartner = {
  completedTransactions: number
  id: string
  name: string
  sourceVolume: OpsOverviewSourceVolume[]
  stablecoinAmount: number
  totalTransactions: number
}

type OpsOverviewPartners = {
  activePartners: number
  top: OpsOverviewPartner[]
  totalPartners: number
}

type OpsOverviewPayoutVolume = {
  amount: number
  currency: TargetCurrency
}

type OpsOverviewSeriesUnit = 'DAY' | 'HOUR'

type OpsOverviewSourceVolume = {
  amount: number
  currency: CryptoCurrency
}

type OpsOverviewTransactionStatusCount = {
  count: number
  status: TransactionStatus
}

type OpsOverviewTreasury = {
  capturedAt: Date
  totalUsd: number
  totalUsdIsPartial: boolean
  venues: OpsOverviewTreasuryVenueHealth
}

type OpsOverviewTreasuryVenueHealth = {
  reporting: number
  total: number
  unavailable: number
}

type OpsOverviewWindow = {
  from: Date
  previousFrom: Date
  previousTo: Date
  range: OpsOverviewRange
  to: Date
}

type PartnerActivityRow = {
  activePartnerCount: number
  completedTransactions: number
  id: string
  name: string
  stablecoinAmount: number
  totalTransactions: number
  usdcAmount: number
  usdtAmount: number
}

const DAY_MS = 24 * 60 * 60 * 1_000
const PARTNER_LIMIT = 5

const FLOW_STATUS_ORDER: FlowInstanceStatus[] = [
  FlowInstanceStatus.NOT_STARTED,
  FlowInstanceStatus.IN_PROGRESS,
  FlowInstanceStatus.WAITING,
  FlowInstanceStatus.FAILED,
  FlowInstanceStatus.COMPLETED,
]

const RANGE_DAYS: Record<OpsOverviewRange, number> = {
  '7d': 7,
  '24h': 1,
  '30d': 30,
}

const TRANSACTION_STATUS_ORDER: TransactionStatus[] = [
  TransactionStatus.AWAITING_PAYMENT,
  TransactionStatus.PROCESSING_PAYMENT,
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.WRONG_AMOUNT,
]

const TERMINAL_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])

const addAmount = <TCurrency extends string>(
  amounts: Map<TCurrency, number>,
  currency: TCurrency,
  amount: number,
): void => {
  amounts.set(currency, (amounts.get(currency) ?? 0) + amount)
}

const buildAccumulator = (): ActivitySummaryAccumulator => ({
  payoutVolume: new Map<TargetCurrency, number>(),
  sourceVolume: new Map<CryptoCurrency, number>(),
  statusCounts: new Map(TRANSACTION_STATUS_ORDER.map(status => [status, 0])),
})

const buildWindow = (range: OpsOverviewRange, to: Date): OpsOverviewWindow => {
  const durationMs = RANGE_DAYS[range] * DAY_MS
  const from = new Date(to.getTime() - durationMs)
  return {
    from,
    previousFrom: new Date(from.getTime() - durationMs),
    previousTo: from,
    range,
    to,
  }
}

const floorBucket = (date: Date, unit: OpsOverviewSeriesUnit): Date => {
  const bucket = new Date(date)
  if (unit === 'HOUR') {
    bucket.setUTCMinutes(0, 0, 0)
  }
  else {
    bucket.setUTCHours(0, 0, 0, 0)
  }
  return bucket
}

const incrementBucket = (date: Date, unit: OpsOverviewSeriesUnit): Date => (
  new Date(date.getTime() + (unit === 'HOUR' ? 60 * 60 * 1_000 : DAY_MS))
)

const roundAmount = (value: number): number => (
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
)

const roundPercent = (value: number): number => (
  Math.round((value + Number.EPSILON) * 100) / 100
)

const toPayoutVolume = (
  amounts: Map<TargetCurrency, number>,
): OpsOverviewPayoutVolume[] => (
  [...amounts.entries()]
    .map(([currency, amount]) => ({ amount: roundAmount(amount), currency }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
)

const toSourceVolume = (
  amounts: Map<CryptoCurrency, number>,
): OpsOverviewSourceVolume[] => (
  [...amounts.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ amount: roundAmount(amount), currency }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
)

const toSummary = (accumulator: ActivitySummaryAccumulator): OpsOverviewActivitySummary => {
  const statusCounts = TRANSACTION_STATUS_ORDER.map(status => ({
    count: accumulator.statusCounts.get(status) ?? 0,
    status,
  }))
  const totalTransactions = statusCounts.reduce((sum, entry) => sum + entry.count, 0)
  const completedTransactions = accumulator.statusCounts.get(TransactionStatus.PAYMENT_COMPLETED) ?? 0
  const terminalTransactions = statusCounts
    .filter(entry => TERMINAL_STATUSES.has(entry.status))
    .reduce((sum, entry) => sum + entry.count, 0)

  return {
    completedTransactions,
    payoutVolume: toPayoutVolume(accumulator.payoutVolume),
    sourceVolume: toSourceVolume(accumulator.sourceVolume),
    statusCounts,
    successRatePct: terminalTransactions > 0
      ? roundPercent((completedTransactions / terminalTransactions) * 100)
      : null,
    totalTransactions,
  }
}

/**
 * A read-only operating summary spanning payment activity, execution state,
 * partner concentration, treasury posture, and bridge settlement health.
 */
@injectable()
export class OpsOverviewService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(OpsBridgeService)
    private readonly bridgeService: OpsBridgeService,
    @inject(OpsTreasuryService)
    private readonly treasuryService: OpsTreasuryService,
    @inject(OpsIncidentService)
    private readonly incidentService: OpsIncidentService,
  ) {}

  public async getOverview(range: OpsOverviewRange): Promise<OpsOverviewResponse> {
    const generatedAt = new Date()
    const window = buildWindow(range, generatedAt)
    const seriesUnit: OpsOverviewSeriesUnit = range === '24h' ? 'HOUR' : 'DAY'
    const client = await this.dbProvider.getClient()

    const [
      activityRows,
      bridge,
      flowStatusRows,
      incidents,
      oldestWaiting,
      partnerRows,
      totalPartners,
      treasury,
    ] = await Promise.all([
      this.readActivity(client, window, seriesUnit),
      this.bridgeService.getOverview(),
      client.flowInstance.groupBy({ _count: { _all: true }, by: ['status'] }),
      this.incidentService.getOverviewInternal(),
      client.flowInstance.findFirst({
        orderBy: { updatedAt: 'asc' },
        select: { updatedAt: true },
        where: { status: FlowInstanceStatus.WAITING },
      }),
      this.readPartnerActivity(client, window),
      client.partner.count(),
      this.treasuryService.getBalances(),
    ])

    return {
      activity: this.buildActivity(activityRows, window, seriesUnit),
      bridge: this.buildBridge(bridge),
      execution: this.buildExecution(flowStatusRows, oldestWaiting?.updatedAt ?? null),
      generatedAt,
      incidents,
      partners: this.buildPartners(partnerRows, totalPartners),
      treasury: this.buildTreasury(treasury),
      window,
    }
  }

  private buildActivity(
    rows: ActivityRow[],
    window: OpsOverviewWindow,
    seriesUnit: OpsOverviewSeriesUnit,
  ): OpsOverviewActivity {
    const current = buildAccumulator()
    const previous = buildAccumulator()
    const seriesStatusByBucket = new Map<number, Map<TransactionStatus, number>>()

    for (const row of rows) {
      const count = Number(row.transactionCount) || 0
      const accumulator = row.period === 'CURRENT' ? current : previous
      accumulator.statusCounts.set(row.status, (accumulator.statusCounts.get(row.status) ?? 0) + count)

      if (row.status === TransactionStatus.PAYMENT_COMPLETED) {
        addAmount(accumulator.sourceVolume, row.cryptoCurrency, Number(row.sourceAmount) || 0)
        addAmount(accumulator.payoutVolume, row.targetCurrency, Number(row.payoutAmount) || 0)
      }

      if (row.period === 'CURRENT') {
        const bucketTime = new Date(row.bucket).getTime()
        const statusCounts = seriesStatusByBucket.get(bucketTime) ?? new Map<TransactionStatus, number>()
        statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + count)
        seriesStatusByBucket.set(bucketTime, statusCounts)
      }
    }

    const series: OpsOverviewActivityPoint[] = []
    for (
      let bucket = floorBucket(window.from, seriesUnit);
      bucket.getTime() < window.to.getTime();
      bucket = incrementBucket(bucket, seriesUnit)
    ) {
      const counts = seriesStatusByBucket.get(bucket.getTime()) ?? new Map<TransactionStatus, number>()
      const count = (status: TransactionStatus): number => counts.get(status) ?? 0
      const completedTransactions = count(TransactionStatus.PAYMENT_COMPLETED)
      const expiredTransactions = count(TransactionStatus.PAYMENT_EXPIRED)
      const failedTransactions = count(TransactionStatus.PAYMENT_FAILED) + count(TransactionStatus.WRONG_AMOUNT)
      const openTransactions = count(TransactionStatus.AWAITING_PAYMENT) + count(TransactionStatus.PROCESSING_PAYMENT)
      series.push({
        at: bucket,
        completedTransactions,
        expiredTransactions,
        failedTransactions,
        openTransactions,
        totalTransactions: completedTransactions + expiredTransactions + failedTransactions + openTransactions,
      })
    }

    return {
      current: toSummary(current),
      previous: toSummary(previous),
      series,
      seriesUnit,
    }
  }

  private buildBridge(bridge: OpsBridgeOverview): OpsOverviewBridge {
    const outstandingStatuses = new Set<BridgeLegStatus>([
      BridgeLegStatus.BATCHED,
      BridgeLegStatus.PENDING,
    ])
    const outstandingLegs = bridge.legs.byStatus
      .filter(group => outstandingStatuses.has(group.status))
      .reduce(
        (summary, group) => ({ amount: summary.amount + group.amount, count: summary.count + group.count }),
        { amount: 0, count: 0 },
      )
    const failedGroup = bridge.legs.byStatus.find(group => group.status === BridgeLegStatus.FAILED)

    return {
      failedLegs: {
        amount: roundAmount(failedGroup?.amount ?? 0),
        count: failedGroup?.count ?? 0,
      },
      float: {
        available: bridge.float.available === null ? null : roundAmount(bridge.float.available),
        cap: bridge.float.cap === null ? null : roundAmount(bridge.float.cap),
        deficit: roundAmount(bridge.float.deficit),
        enabled: bridge.float.enabled,
      },
      oldestPendingAt: bridge.legs.oldestPendingAt,
      outstandingLegs: {
        amount: roundAmount(outstandingLegs.amount),
        count: outstandingLegs.count,
      },
    }
  }

  private buildExecution(
    rows: FlowStatusRow[],
    oldestWaitingAt: Date | null,
  ): OpsOverviewExecution {
    const countByStatus = new Map(rows.map(row => [row.status, row._count._all]))
    const statusCounts = FLOW_STATUS_ORDER.map(status => ({
      count: countByStatus.get(status) ?? 0,
      status,
    }))
    return {
      oldestWaitingAt,
      statusCounts,
      totalFlows: statusCounts.reduce((sum, entry) => sum + entry.count, 0),
    }
  }

  private buildPartners(rows: PartnerActivityRow[], totalPartners: number): OpsOverviewPartners {
    return {
      activePartners: rows[0]?.activePartnerCount ?? 0,
      top: rows.map(row => ({
        completedTransactions: Number(row.completedTransactions) || 0,
        id: row.id,
        name: row.name,
        sourceVolume: toSourceVolume(new Map([
          [CryptoCurrency.USDC, Number(row.usdcAmount) || 0],
          [CryptoCurrency.USDT, Number(row.usdtAmount) || 0],
        ])),
        stablecoinAmount: roundAmount(Number(row.stablecoinAmount) || 0),
        totalTransactions: Number(row.totalTransactions) || 0,
      })),
      totalPartners,
    }
  }

  private buildTreasury(treasury: OpsTreasuryBalancesResponse): OpsOverviewTreasury {
    const reportingVenues = new Set(treasury.cells.map(cell => cell.venue))
    const unavailableVenues = new Set(treasury.errors.map(error => error.venue))
    const totalVenues = new Set([...reportingVenues, ...unavailableVenues])
    return {
      capturedAt: treasury.capturedAt,
      totalUsd: roundAmount(treasury.totalUsd),
      totalUsdIsPartial: treasury.totalUsdIsPartial,
      venues: {
        reporting: reportingVenues.size,
        total: totalVenues.size,
        unavailable: unavailableVenues.size,
      },
    }
  }

  private async readActivity(
    client: PrismaClient,
    window: OpsOverviewWindow,
    seriesUnit: OpsOverviewSeriesUnit,
  ): Promise<ActivityRow[]> {
    const bucketUnit = seriesUnit === 'HOUR' ? 'hour' : 'day'
    return client.$queryRaw<ActivityRow[]>(Prisma.sql`
      SELECT
        CASE
          WHEN transaction."createdAt" >= ${window.from} THEN 'CURRENT'
          ELSE 'PREVIOUS'
        END AS "period",
        DATE_TRUNC(${bucketUnit}, transaction."createdAt") AS "bucket",
        transaction."status",
        quote."cryptoCurrency",
        quote."targetCurrency",
        COUNT(*)::integer AS "transactionCount",
        COALESCE(SUM(quote."sourceAmount"), 0)::double precision AS "sourceAmount",
        COALESCE(SUM(quote."targetAmount"), 0)::double precision AS "payoutAmount"
      FROM "Transaction" AS transaction
      INNER JOIN "Quote" AS quote ON quote."id" = transaction."quoteId"
      WHERE
        transaction."createdAt" >= ${window.previousFrom}
        AND transaction."createdAt" < ${window.to}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1, 2, 3, 4, 5
    `)
  }

  private async readPartnerActivity(
    client: PrismaClient,
    window: OpsOverviewWindow,
  ): Promise<PartnerActivityRow[]> {
    return client.$queryRaw<PartnerActivityRow[]>(Prisma.sql`
      WITH partner_activity AS (
        SELECT
          partner."id",
          partner."name",
          COUNT(*)::integer AS "totalTransactions",
          COUNT(*) FILTER (
            WHERE transaction."status" = ${TransactionStatus.PAYMENT_COMPLETED}::"TransactionStatus"
          )::integer AS "completedTransactions",
          COALESCE(SUM(quote."sourceAmount") FILTER (
            WHERE transaction."status" = ${TransactionStatus.PAYMENT_COMPLETED}::"TransactionStatus"
          ), 0)::double precision AS "stablecoinAmount",
          COALESCE(SUM(quote."sourceAmount") FILTER (
            WHERE
              transaction."status" = ${TransactionStatus.PAYMENT_COMPLETED}::"TransactionStatus"
              AND quote."cryptoCurrency" = ${CryptoCurrency.USDC}::"CryptoCurrency"
          ), 0)::double precision AS "usdcAmount",
          COALESCE(SUM(quote."sourceAmount") FILTER (
            WHERE
              transaction."status" = ${TransactionStatus.PAYMENT_COMPLETED}::"TransactionStatus"
              AND quote."cryptoCurrency" = ${CryptoCurrency.USDT}::"CryptoCurrency"
          ), 0)::double precision AS "usdtAmount"
        FROM "Transaction" AS transaction
        INNER JOIN "Quote" AS quote ON quote."id" = transaction."quoteId"
        INNER JOIN "Partner" AS partner ON partner."id" = quote."partnerId"
        WHERE
          transaction."createdAt" >= ${window.from}
          AND transaction."createdAt" < ${window.to}
        GROUP BY partner."id", partner."name"
      )
      SELECT
        "id",
        "name",
        "totalTransactions",
        "completedTransactions",
        "stablecoinAmount",
        "usdcAmount",
        "usdtAmount",
        COUNT(*) OVER ()::integer AS "activePartnerCount"
      FROM partner_activity
      ORDER BY
        "stablecoinAmount" DESC,
        "totalTransactions" DESC,
        "name" ASC,
        "id" ASC
      LIMIT ${PARTNER_LIMIT}
    `)
  }
}
