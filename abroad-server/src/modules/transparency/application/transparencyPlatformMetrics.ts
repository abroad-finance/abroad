import { CryptoCurrency, Prisma, type PrismaClient, TransactionStatus } from '@prisma/client'

import type { PublicCorridorService } from '../../flows/application/PublicCorridorService'
import type {
  TransparencyCoverage,
  TransparencyDailyOutcome,
  TransparencyPlatformSnapshot,
  TransparencyStatusCount,
  TransparencyVolume,
} from './transparencyContracts'

const DAY_MS = 24 * 60 * 60 * 1000
const ROLLING_WINDOW_DAYS = 30
const TERMINAL_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])

type DailyStatusRow = {
  count: bigint
  date: string
  status: TransactionStatus
}

type StatusSummary = {
  accepted: number
  completed: number
  completionRate: null | number
}

const readCompletedVolume = async (
  client: PrismaClient,
  createdAt?: Date,
): Promise<TransparencyVolume[]> => (
  Promise.all(
    Object.values(CryptoCurrency).map(async (asset) => {
      const aggregate = await client.quote.aggregate({
        _sum: { sourceAmount: true },
        where: {
          cryptoCurrency: asset,
          transaction: {
            is: {
              createdAt: createdAt ? { gte: createdAt } : undefined,
              status: TransactionStatus.PAYMENT_COMPLETED,
            },
          },
        },
      })

      return {
        amount: roundAmount(aggregate._sum.sourceAmount ?? 0),
        asset,
      }
    }),
  )
)

const readDailyStatusCounts = async (
  client: PrismaClient,
  createdAt: Date,
): Promise<DailyStatusRow[]> => (
  client.$queryRaw<DailyStatusRow[]>(Prisma.sql`
    SELECT
      TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "date",
      "status",
      COUNT(*)::bigint AS "count"
    FROM "Transaction"
    WHERE "createdAt" >= ${createdAt}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
)

const readStatusCounts = async (
  client: PrismaClient,
  createdAt?: Date,
): Promise<TransparencyStatusCount[]> => {
  const rows = await client.transaction.groupBy({
    _count: { _all: true },
    by: ['status'],
    where: createdAt ? { createdAt: { gte: createdAt } } : undefined,
  })

  const counts = new Map(rows.map(row => [row.status, row._count._all]))
  return Object.values(TransactionStatus).map(status => ({
    count: counts.get(status) ?? 0,
    status,
  }))
}

const roundAmount = (value: number): number => (
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
)

const roundRate = (value: number): number => (
  Math.round((value + Number.EPSILON) * 10) / 10
)

const startOfUtcDay = (date: Date): Date => (
  new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ))
)

const summarizeStatuses = (statuses: TransparencyStatusCount[]): StatusSummary => {
  let accepted = 0
  let completed = 0
  let terminal = 0

  for (const item of statuses) {
    accepted += item.count
    if (item.status === TransactionStatus.PAYMENT_COMPLETED) completed = item.count
    if (TERMINAL_STATUSES.has(item.status)) terminal += item.count
  }

  return {
    accepted,
    completed,
    completionRate: terminal === 0 ? null : roundRate((completed / terminal) * 100),
  }
}

const toCoverage = (
  corridors: Awaited<ReturnType<PublicCorridorService['list']>>['corridors'],
): TransparencyCoverage => ({
  corridors: corridors.length,
  networks: uniqueSorted(corridors.map(corridor => corridor.blockchain)),
  payoutCurrencies: uniqueSorted(corridors.map(corridor => corridor.targetCurrency)),
  payoutMethods: uniqueSorted(corridors.map(corridor => corridor.paymentMethod)),
  sourceAssets: uniqueSorted(corridors.map(corridor => corridor.cryptoCurrency)),
})

const toDailyOutcomes = (
  rows: DailyStatusRow[],
  start: Date,
  numberOfDays: number,
): TransparencyDailyOutcome[] => {
  const byDay = new Map<string, Map<TransactionStatus, number>>()
  for (const row of rows) {
    const day = byDay.get(row.date) ?? new Map<TransactionStatus, number>()
    day.set(row.status, Number(row.count))
    byDay.set(row.date, day)
  }

  return Array.from({ length: numberOfDays }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS)
    const key = date.toISOString().slice(0, 10)
    const counts = byDay.get(key) ?? new Map<TransactionStatus, number>()
    const completed = counts.get(TransactionStatus.PAYMENT_COMPLETED) ?? 0
    const failed = counts.get(TransactionStatus.PAYMENT_FAILED) ?? 0
    const otherTerminal = (counts.get(TransactionStatus.PAYMENT_EXPIRED) ?? 0)
      + (counts.get(TransactionStatus.WRONG_AMOUNT) ?? 0)
    const inFlight = (counts.get(TransactionStatus.AWAITING_PAYMENT) ?? 0)
      + (counts.get(TransactionStatus.PROCESSING_PAYMENT) ?? 0)

    return {
      accepted: completed + failed + otherTerminal + inFlight,
      completed,
      date: key,
      failed,
      inFlight,
      otherTerminal,
    }
  })
}

const uniqueSorted = (values: string[]): string[] => (
  [...new Set(values)].sort((left, right) => left.localeCompare(right))
)

export const readTransparencyPlatformMetrics = async (
  client: PrismaClient,
  corridorService: PublicCorridorService,
): Promise<TransparencyPlatformSnapshot> => {
  const now = new Date()
  const rollingStart = startOfUtcDay(
    new Date(now.getTime() - (ROLLING_WINDOW_DAYS - 1) * DAY_MS),
  )

  const [
    partnerOrganizations,
    userRecords,
    allStatuses,
    rollingStatuses,
    activePartnerOrganizations,
    activeUserRecords,
    allVolume,
    rollingVolume,
    dailyRows,
    coverageResponse,
  ] = await Promise.all([
    client.partner.count(),
    client.partnerUser.count(),
    readStatusCounts(client),
    readStatusCounts(client, rollingStart),
    client.partner.count({
      where: {
        users: {
          some: {
            transaction: { some: { createdAt: { gte: rollingStart } } },
          },
        },
      },
    }),
    client.partnerUser.count({
      where: {
        transaction: { some: { createdAt: { gte: rollingStart } } },
      },
    }),
    readCompletedVolume(client),
    readCompletedVolume(client, rollingStart),
    readDailyStatusCounts(client, rollingStart),
    corridorService.list(),
  ])

  const allSummary = summarizeStatuses(allStatuses)
  const rollingSummary = summarizeStatuses(rollingStatuses)

  return {
    coverage: toCoverage(coverageResponse.corridors),
    dailyOutcomes: toDailyOutcomes(dailyRows, rollingStart, ROLLING_WINDOW_DAYS),
    generatedAt: new Date().toISOString(),
    rolling30Days: {
      acceptedTransactions: rollingSummary.accepted,
      activePartnerOrganizations,
      activeUserRecords,
      completedSourceVolume: rollingVolume,
      completedTransactions: rollingSummary.completed,
      completionRate: rollingSummary.completionRate,
      statusBreakdown: rollingStatuses,
    },
    totals: {
      acceptedTransactions: allSummary.accepted,
      completedSourceVolume: allVolume,
      completedTransactions: allSummary.completed,
      completionRate: allSummary.completionRate,
      partnerOrganizations,
      statusBreakdown: allStatuses,
      userRecords,
    },
  }
}
