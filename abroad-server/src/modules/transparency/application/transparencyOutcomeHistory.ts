import { Prisma, type PrismaClient, TransactionStatus } from '@prisma/client'

import type { TransparencyDailyOutcome, TransparencyHistoricalOutcome, TransparencyHistory } from './transparencyContracts'

const DAY_MS = 24 * 60 * 60 * 1000

type OutcomeCounts = Omit<TransparencyHistoricalOutcome, 'periodStart'>

type PeriodStatusRow = {
  count: bigint
  periodStart: string
  status: TransactionStatus
}

const countOutcomes = (
  counts: Map<TransactionStatus, number>,
): OutcomeCounts => {
  const completed = counts.get(TransactionStatus.PAYMENT_COMPLETED) ?? 0
  const failed = counts.get(TransactionStatus.PAYMENT_FAILED) ?? 0
  const otherTerminal = (counts.get(TransactionStatus.PAYMENT_EXPIRED) ?? 0)
    + (counts.get(TransactionStatus.WRONG_AMOUNT) ?? 0)
  const inFlight = (counts.get(TransactionStatus.AWAITING_PAYMENT) ?? 0)
    + (counts.get(TransactionStatus.PROCESSING_PAYMENT) ?? 0)

  return {
    accepted: completed + failed + otherTerminal + inFlight,
    completed,
    failed,
    inFlight,
    otherTerminal,
  }
}

const indexRowsByPeriod = (
  rows: PeriodStatusRow[],
): Map<string, Map<TransactionStatus, number>> => {
  const byPeriod = new Map<string, Map<TransactionStatus, number>>()

  for (const row of rows) {
    const period = byPeriod.get(row.periodStart)
      ?? new Map<TransactionStatus, number>()
    period.set(row.status, Number(row.count))
    byPeriod.set(row.periodStart, period)
  }

  return byPeriod
}

const monthStart = (date: Date): Date => (
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
)

const parsePeriod = (periodStart: string): Date => (
  new Date(`${periodStart}T00:00:00.000Z`)
)

const toPeriodKey = (date: Date): string => date.toISOString().slice(0, 10)

export const readDailyStatusCounts = async (
  client: PrismaClient,
  createdAt: Date,
): Promise<PeriodStatusRow[]> => (
  client.$queryRaw<PeriodStatusRow[]>(Prisma.sql`
    SELECT
      TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "periodStart",
      "status",
      COUNT(*)::bigint AS "count"
    FROM "Transaction"
    WHERE "createdAt" >= ${createdAt}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
)

export const readMonthlyStatusCounts = async (
  client: PrismaClient,
): Promise<PeriodStatusRow[]> => (
  client.$queryRaw<PeriodStatusRow[]>(Prisma.sql`
    SELECT
      TO_CHAR(
        DATE_TRUNC('month', "createdAt" AT TIME ZONE 'UTC'),
        'YYYY-MM-DD'
      ) AS "periodStart",
      "status",
      COUNT(*)::bigint AS "count"
    FROM "Transaction"
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)
)

export const toDailyOutcomes = (
  rows: PeriodStatusRow[],
  start: Date,
  numberOfDays: number,
): TransparencyDailyOutcome[] => {
  const byPeriod = indexRowsByPeriod(rows)

  return Array.from({ length: numberOfDays }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS)
    const key = toPeriodKey(date)

    return {
      ...countOutcomes(
        byPeriod.get(key) ?? new Map<TransactionStatus, number>(),
      ),
      date: key,
    }
  })
}

export const toHistoricalOutcomes = (
  rows: PeriodStatusRow[],
  through: Date,
): TransparencyHistory => {
  if (rows.length === 0) {
    return {
      granularity: 'month',
      outcomes: [],
    }
  }

  const byPeriod = indexRowsByPeriod(rows)
  const firstPeriod = [...byPeriod.keys()]
    .map(parsePeriod)
    .reduce((earliest, date) => date < earliest ? date : earliest)
  const lastPeriod = monthStart(through)
  const numberOfMonths = (
    (lastPeriod.getUTCFullYear() - firstPeriod.getUTCFullYear()) * 12
    + lastPeriod.getUTCMonth()
    - firstPeriod.getUTCMonth()
    + 1
  )

  const outcomes = Array.from(
    { length: Math.max(0, numberOfMonths) },
    (_, index): TransparencyHistoricalOutcome => {
      const period = new Date(Date.UTC(
        firstPeriod.getUTCFullYear(),
        firstPeriod.getUTCMonth() + index,
        1,
      ))
      const periodStart = toPeriodKey(period)

      return {
        ...countOutcomes(
          byPeriod.get(periodStart) ?? new Map<TransactionStatus, number>(),
        ),
        periodStart,
      }
    },
  )

  return {
    granularity: 'month',
    outcomes,
  }
}
