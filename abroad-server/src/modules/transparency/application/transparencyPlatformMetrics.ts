import { CryptoCurrency, type PrismaClient, TransactionStatus } from '@prisma/client'

import type { PublicCorridorService } from '../../flows/application/PublicCorridorService'
import type { TransparencyCoverage, TransparencyPlatformSnapshot, TransparencyStatusCount, TransparencyVolume } from './transparencyContracts'

import { readDailyStatusCounts, readMonthlyStatusCounts, toDailyOutcomes, toHistoricalOutcomes } from './transparencyOutcomeHistory'

const DAY_MS = 24 * 60 * 60 * 1000
const ROLLING_WINDOW_DAYS = 30
const TERMINAL_STATUSES = new Set<TransactionStatus>([
  TransactionStatus.PAYMENT_COMPLETED,
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])

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
    monthlyRows,
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
    readMonthlyStatusCounts(client),
    corridorService.list(),
  ])

  const allSummary = summarizeStatuses(allStatuses)
  const rollingSummary = summarizeStatuses(rollingStatuses)

  return {
    coverage: toCoverage(coverageResponse.corridors),
    dailyOutcomes: toDailyOutcomes(dailyRows, rollingStart, ROLLING_WINDOW_DAYS),
    generatedAt: new Date().toISOString(),
    history: toHistoricalOutcomes(monthlyRows, now),
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
