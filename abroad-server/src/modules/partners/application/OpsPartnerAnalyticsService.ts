import {
  CryptoCurrency,
  OpsWorkStatus,
  OutboxStatus,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export const OPS_PARTNER_ANALYTICS_RANGES = ['24h', '7d', '30d', '90d'] as const
export type OpsPartnerActivityFilter = 'ACTIVE' | 'INACTIVE'
export type OpsPartnerAnalyticsRange = typeof OPS_PARTNER_ANALYTICS_RANGES[number]
type OpsPartnerCurrencyAmount = {
  amount: number
  currency: string
}

type OpsPartnerDirectoryItem = {
  completedTransactions: number
  country: null | string
  createdAt: Date
  failedTransactions: number
  id: string
  lifecycle: OpsPartnerLifecycleFilter
  name: string
  payoutVolume: OpsPartnerCurrencyAmount[]
  sourceVolume: OpsPartnerCurrencyAmount[]
  stablecoinAmount: number
  successRatePct: null | number
  totalTransactions: number
}

type OpsPartnerDirectoryParams = {
  activity?: OpsPartnerActivityFilter
  country?: string
  lifecycle?: OpsPartnerLifecycleFilter
  page: number
  pageSize: number
  query?: string
  range: OpsPartnerAnalyticsRange
}

export type OpsPartnerDirectoryResponse = {
  filterOptions: { countries: string[] }
  from: Date
  items: OpsPartnerDirectoryItem[]
  maximumStablecoinAmount: number
  page: number
  pageSize: number
  range: OpsPartnerAnalyticsRange
  to: Date
  total: number
}

export type OpsPartnerLifecycleFilter = 'LIVE' | 'NO_CREDENTIALS' | 'ONBOARDING'

export type OpsPartnerScorecard = {
  activity: {
    completedTransactions: number
    failedTransactions: number
    payoutVolume: OpsPartnerCurrencyAmount[]
    sourceVolume: OpsPartnerCurrencyAmount[]
    stablecoinAmount: number
    statusCounts: Array<{ count: number, status: string }>
    successRatePct: null | number
    totalTransactions: number
  }
  cases: Array<{ count: number, status: string }>
  corridors: Array<{
    blockchain: string
    completedTransactions: number
    cryptoCurrency: string
    sharePct: number
    stablecoinAmount: number
    targetCurrency: string
  }>
  from: Date
  incidents: Array<{
    href: string
    id: string
    severity: string
    status: string
    title: string
  }>
  partner: {
    country: null | string
    createdAt: Date
    id: string
    lifecycle: OpsPartnerLifecycleFilter
    name: string
  }
  range: OpsPartnerAnalyticsRange
  to: Date
  transactionPath: string
  trend: Array<{
    at: Date
    completed: number
    failed: number
    open: number
    total: number
  }>
  trendUnit: 'DAY' | 'HOUR'
  webhook: {
    delivered: number
    failed: number
    lastDeliveredAt: Date | null
    pending: number
    successRatePct: null | number
    total: number
  }
}

type ActivityRow = {
  count: number
  cryptoCurrency: CryptoCurrency
  partnerId: string
  sourceAmount: number
  status: TransactionStatus
  targetAmount: number
  targetCurrency: TargetCurrency
}

type CorridorRow = {
  blockchain: string
  completedTransactions: number
  cryptoCurrency: CryptoCurrency
  sourceAmount: number
  targetCurrency: TargetCurrency
}

type MutableActivity = {
  payout: Map<string, number>
  source: Map<string, number>
  statusCounts: Map<TransactionStatus, number>
}

type PartnerRecord = {
  apiKey: null | string
  country: null | string
  createdAt: Date
  id: string
  isKybApproved: boolean | null
  name: string
  portalApiKeys: Array<{ id: string }>
}

type TrendRow = {
  at: Date
  count: number
  status: TransactionStatus
}

const FAILURE_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])

const OPEN_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.AWAITING_PAYMENT,
  TransactionStatus.PROCESSING_PAYMENT,
])

const rangeMilliseconds: Record<OpsPartnerAnalyticsRange, number> = {
  '7d': 7 * 24 * 60 * 60 * 1_000,
  '24h': 24 * 60 * 60 * 1_000,
  '30d': 30 * 24 * 60 * 60 * 1_000,
  '90d': 90 * 24 * 60 * 60 * 1_000,
}

const roundAmount = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000

const toAmounts = (amounts: Map<string, number>): OpsPartnerCurrencyAmount[] => (
  [...amounts.entries()]
    .map(([currency, amount]) => ({ amount: roundAmount(amount), currency }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
)

const lifecycleFor = (partner: PartnerRecord): OpsPartnerLifecycleFilter => {
  if (!partner.isKybApproved) return 'ONBOARDING'
  return partner.apiKey || partner.portalApiKeys.length > 0 ? 'LIVE' : 'NO_CREDENTIALS'
}

const contextContainsPartner = (context: null | Prisma.JsonValue, partnerId: string): boolean => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return false
  const affected = context.affected
  if (!Array.isArray(affected)) return false
  return affected.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    return value.type === 'PARTNER' && value.id === partnerId
  })
}

export class OpsPartnerAnalyticsNotFoundError extends Error {
  public constructor() {
    super('Partner not found')
    this.name = 'OpsPartnerAnalyticsNotFoundError'
  }
}

@injectable()
export class OpsPartnerAnalyticsService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async getScorecard(
    partnerId: string,
    range: OpsPartnerAnalyticsRange,
  ): Promise<OpsPartnerScorecard> {
    const prisma = await this.databaseClientProvider.getClient()
    const to = new Date()
    const from = new Date(to.getTime() - rangeMilliseconds[range])
    const partner = await prisma.partner.findUnique({
      select: {
        apiKey: true,
        country: true,
        createdAt: true,
        id: true,
        isKybApproved: true,
        name: true,
        portalApiKeys: {
          select: { id: true },
          take: 1,
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: to } }],
            revokedAt: null,
          },
        },
      },
      where: { id: partnerId },
    })
    if (!partner) throw new OpsPartnerAnalyticsNotFoundError()

    const [activityRows, trendRows, corridorRows, webhookCounts, lastDelivery, caseCounts, incidents] = await Promise.all([
      this.readActivityRows(prisma, [partnerId], from, to),
      this.readTrendRows(prisma, partnerId, from, to, range === '24h' ? 'hour' : 'day'),
      prisma.$queryRaw<CorridorRow[]>(Prisma.sql`
        SELECT
          quote."blockchain"::text AS "blockchain",
          quote."cryptoCurrency",
          quote."targetCurrency",
          COUNT(*)::integer AS "completedTransactions",
          COALESCE(SUM(quote."sourceAmount"), 0)::double precision AS "sourceAmount"
        FROM "Quote" AS quote
        INNER JOIN "Transaction" AS transaction ON transaction."quoteId" = quote."id"
        WHERE quote."partnerId" = ${partnerId}
          AND transaction."status" = ${TransactionStatus.PAYMENT_COMPLETED}::"TransactionStatus"
          AND transaction."createdAt" >= ${from}
          AND transaction."createdAt" <= ${to}
        GROUP BY quote."blockchain", quote."cryptoCurrency", quote."targetCurrency"
        ORDER BY "sourceAmount" DESC
      `),
      prisma.outboxEvent.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: { createdAt: { gte: from, lte: to }, partnerId },
      }),
      prisma.outboxEvent.findFirst({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { updatedAt: true },
        where: { partnerId, status: OutboxStatus.DELIVERED },
      }),
      prisma.opsCase.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: {
          transaction: {
            createdAt: { gte: from, lte: to },
            quote: { partnerId },
          },
        },
      }),
      prisma.opsIncident.findMany({
        orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
        select: {
          context: true,
          id: true,
          severity: true,
          status: true,
          title: true,
        },
        take: 100,
        where: { status: { not: OpsWorkStatus.RESOLVED } },
      }),
    ])

    const activity = this.summarizeActivity(activityRows)[0] ?? this.emptyActivity(partnerId)
    const webhook = new Map(webhookCounts.map(row => [row.status, row._count._all]))
    const delivered = webhook.get(OutboxStatus.DELIVERED) ?? 0
    const failed = webhook.get(OutboxStatus.FAILED) ?? 0
    const pending = (webhook.get(OutboxStatus.PENDING) ?? 0) + (webhook.get(OutboxStatus.DELIVERING) ?? 0)
    const webhookTotal = delivered + failed + pending
    const corridorTotal = corridorRows.reduce((sum, row) => sum + row.sourceAmount, 0)

    return {
      activity: this.toActivityDto(activity),
      cases: caseCounts.map(row => ({ count: row._count._all, status: row.status })),
      corridors: corridorRows.map(row => ({
        blockchain: row.blockchain,
        completedTransactions: row.completedTransactions,
        cryptoCurrency: row.cryptoCurrency,
        sharePct: corridorTotal > 0 ? roundAmount((row.sourceAmount / corridorTotal) * 100) : 0,
        stablecoinAmount: roundAmount(row.sourceAmount),
        targetCurrency: row.targetCurrency,
      })),
      from,
      incidents: incidents
        .filter(incident => contextContainsPartner(incident.context, partnerId))
        .slice(0, 10)
        .map(incident => ({
          href: `/ops/incidents/${incident.id}`,
          id: incident.id,
          severity: incident.severity,
          status: incident.status,
          title: incident.title,
        })),
      partner: {
        country: partner.country,
        createdAt: partner.createdAt,
        id: partner.id,
        lifecycle: lifecycleFor(partner),
        name: partner.name,
      },
      range,
      to,
      transactionPath: `/ops/transactions?partnerId=${encodeURIComponent(partnerId)}&createdFrom=${encodeURIComponent(from.toISOString())}&createdTo=${encodeURIComponent(to.toISOString())}`,
      trend: this.summarizeTrend(trendRows),
      trendUnit: range === '24h' ? 'HOUR' : 'DAY',
      webhook: {
        delivered,
        failed,
        lastDeliveredAt: lastDelivery?.updatedAt ?? null,
        pending,
        successRatePct: delivered + failed > 0 ? roundAmount((delivered / (delivered + failed)) * 100) : null,
        total: webhookTotal,
      },
    }
  }

  public async listDirectory(params: OpsPartnerDirectoryParams): Promise<OpsPartnerDirectoryResponse> {
    const prisma = await this.databaseClientProvider.getClient()
    const to = new Date()
    const from = new Date(to.getTime() - rangeMilliseconds[params.range])
    const query = params.query?.trim()
    const country = params.country?.trim().toUpperCase()
    const partners = await prisma.partner.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: {
        apiKey: true,
        country: true,
        createdAt: true,
        id: true,
        isKybApproved: true,
        name: true,
        portalApiKeys: {
          select: { id: true },
          take: 1,
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: to } }],
            revokedAt: null,
          },
        },
      },
      where: {
        ...(country ? { country: { equals: country, mode: 'insensitive' } } : {}),
        ...(query
          ? {
              OR: [
                { id: { contains: query, mode: 'insensitive' as const } },
                { name: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
    })
    const activities = this.summarizeActivity(await this.readActivityRows(
      prisma,
      partners.map(partner => partner.id),
      from,
      to,
    ))
    const activityByPartner = new Map(activities.map(activity => [activity.partnerId, activity]))
    const countries = [...new Set(partners.map(partner => partner.country).filter((value): value is string => Boolean(value)))].sort()
    const filtered = partners
      .map((partner): OpsPartnerDirectoryItem => {
        const activity = activityByPartner.get(partner.id) ?? this.emptyActivity(partner.id)
        const summary = this.toActivityDto(activity)
        return {
          completedTransactions: summary.completedTransactions,
          country: partner.country,
          createdAt: partner.createdAt,
          failedTransactions: summary.failedTransactions,
          id: partner.id,
          lifecycle: lifecycleFor(partner),
          name: partner.name,
          payoutVolume: summary.payoutVolume,
          sourceVolume: summary.sourceVolume,
          stablecoinAmount: summary.stablecoinAmount,
          successRatePct: summary.successRatePct,
          totalTransactions: summary.totalTransactions,
        }
      })
      .filter(item => !params.lifecycle || item.lifecycle === params.lifecycle)
      .filter(item => !params.activity || (params.activity === 'ACTIVE' ? item.totalTransactions > 0 : item.totalTransactions === 0))
      .sort((left, right) => (
        right.stablecoinAmount - left.stablecoinAmount
        || right.completedTransactions - left.completedTransactions
        || right.createdAt.getTime() - left.createdAt.getTime()
        || left.id.localeCompare(right.id)
      ))
    const skip = (params.page - 1) * params.pageSize

    return {
      filterOptions: { countries },
      from,
      items: filtered.slice(skip, skip + params.pageSize),
      maximumStablecoinAmount: filtered[0]?.stablecoinAmount ?? 0,
      page: params.page,
      pageSize: params.pageSize,
      range: params.range,
      to,
      total: filtered.length,
    }
  }

  private emptyActivity(partnerId: string): MutableActivity & { partnerId: string } {
    return {
      partnerId,
      payout: new Map(),
      source: new Map(),
      statusCounts: new Map(),
    }
  }

  private async readActivityRows(
    prisma: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    partnerIds: string[],
    from: Date,
    to: Date,
  ): Promise<ActivityRow[]> {
    if (partnerIds.length === 0) return []
    return prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
      SELECT
        quote."partnerId",
        transaction."status",
        quote."cryptoCurrency",
        quote."targetCurrency",
        COUNT(*)::integer AS "count",
        COALESCE(SUM(quote."sourceAmount"), 0)::double precision AS "sourceAmount",
        COALESCE(SUM(quote."targetAmount"), 0)::double precision AS "targetAmount"
      FROM "Transaction" AS transaction
      INNER JOIN "Quote" AS quote ON quote."id" = transaction."quoteId"
      WHERE quote."partnerId" IN (${Prisma.join(partnerIds)})
        AND transaction."createdAt" >= ${from}
        AND transaction."createdAt" <= ${to}
      GROUP BY quote."partnerId", transaction."status", quote."cryptoCurrency", quote."targetCurrency"
    `)
  }

  private async readTrendRows(
    prisma: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    partnerId: string,
    from: Date,
    to: Date,
    unit: 'day' | 'hour',
  ): Promise<TrendRow[]> {
    const safeUnit = unit === 'hour' ? Prisma.raw(`'hour'`) : Prisma.raw(`'day'`)
    return prisma.$queryRaw<TrendRow[]>(Prisma.sql`
      SELECT
        date_trunc(${safeUnit}, transaction."createdAt") AS "at",
        transaction."status",
        COUNT(*)::integer AS "count"
      FROM "Transaction" AS transaction
      INNER JOIN "Quote" AS quote ON quote."id" = transaction."quoteId"
      WHERE quote."partnerId" = ${partnerId}
        AND transaction."createdAt" >= ${from}
        AND transaction."createdAt" <= ${to}
      GROUP BY "at", transaction."status"
      ORDER BY "at" ASC
    `)
  }

  private summarizeActivity(rows: ActivityRow[]): Array<MutableActivity & { partnerId: string }> {
    const byPartner = new Map<string, MutableActivity & { partnerId: string }>()
    for (const row of rows) {
      const activity = byPartner.get(row.partnerId) ?? this.emptyActivity(row.partnerId)
      activity.statusCounts.set(row.status, (activity.statusCounts.get(row.status) ?? 0) + row.count)
      if (row.status === TransactionStatus.PAYMENT_COMPLETED) {
        activity.source.set(row.cryptoCurrency, (activity.source.get(row.cryptoCurrency) ?? 0) + row.sourceAmount)
        activity.payout.set(row.targetCurrency, (activity.payout.get(row.targetCurrency) ?? 0) + row.targetAmount)
      }
      byPartner.set(row.partnerId, activity)
    }
    return [...byPartner.values()]
  }

  private summarizeTrend(rows: TrendRow[]): OpsPartnerScorecard['trend'] {
    const byTimestamp = new Map<number, OpsPartnerScorecard['trend'][number]>()
    for (const row of rows) {
      const timestamp = row.at.getTime()
      const point = byTimestamp.get(timestamp) ?? {
        at: row.at,
        completed: 0,
        failed: 0,
        open: 0,
        total: 0,
      }
      point.total += row.count
      if (row.status === TransactionStatus.PAYMENT_COMPLETED) point.completed += row.count
      else if (FAILURE_STATUSES.has(row.status)) point.failed += row.count
      else if (OPEN_STATUSES.has(row.status)) point.open += row.count
      byTimestamp.set(timestamp, point)
    }
    return [...byTimestamp.values()].sort((left, right) => left.at.getTime() - right.at.getTime())
  }

  private toActivityDto(activity: MutableActivity): OpsPartnerScorecard['activity'] {
    const completedTransactions = activity.statusCounts.get(TransactionStatus.PAYMENT_COMPLETED) ?? 0
    const failedTransactions = [...activity.statusCounts.entries()]
      .filter(([status]) => FAILURE_STATUSES.has(status))
      .reduce((sum, [, count]) => sum + count, 0)
    const totalTransactions = [...activity.statusCounts.values()].reduce((sum, count) => sum + count, 0)
    const terminal = completedTransactions + failedTransactions
    const sourceVolume = toAmounts(activity.source)
    return {
      completedTransactions,
      failedTransactions,
      payoutVolume: toAmounts(activity.payout),
      sourceVolume,
      stablecoinAmount: roundAmount(sourceVolume.reduce((sum, amount) => sum + amount.amount, 0)),
      statusCounts: [...activity.statusCounts.entries()]
        .map(([status, count]) => ({ count, status }))
        .sort((left, right) => left.status.localeCompare(right.status)),
      successRatePct: terminal > 0 ? roundAmount((completedTransactions / terminal) * 100) : null,
      totalTransactions,
    }
  }
}
