import { CryptoCurrency, TargetCurrency } from '@prisma/client'
import { inject, injectable, multiInject } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { BridgeFloatService } from './BridgeFloatService'
import { IExchangeProviderFactory } from './contracts/IExchangeProviderFactory'
import { ITreasuryBalanceSource } from './contracts/ITreasuryBalanceSource'

export type OpsTreasuryBalanceCell = {
  account: string
  amount: number
  currency: string
  /** USD per 1 unit of currency (1 for USD stables); null when no rate is available. */
  usdRate: null | number
  usdValue: null | number
  venue: string
}

export type OpsTreasuryBalancesResponse = {
  capturedAt: Date
  cells: OpsTreasuryBalanceCell[]
  errors: OpsTreasuryVenueError[]
  /** Bridge float gauge. Outstanding legs are USDC already counted at Binance, so this is context, not an addend. */
  float: OpsTreasuryFloatDto
  fxRates: OpsTreasuryFxRate[]
  totalUsd: number
  /** True when a venue errored or a cell had no FX rate — totalUsd is then a lower bound. */
  totalUsdIsPartial: boolean
}

export type OpsTreasuryFloatDto = {
  available: null | number
  cap: null | number
  deficit: number
  enabled: boolean
}

export type OpsTreasuryFxRate = {
  currency: string
  /** Indicative mid/ask taken at read time. */
  usdPerUnit: number
}

export type OpsTreasuryMovementBucket = {
  amount: number
  currency: string
}

export type OpsTreasuryMovementDay = {
  bridgeSettledUsdc: number
  /** UTC calendar date, YYYY-MM-DD. */
  date: string
  inboundCrypto: OpsTreasuryMovementBucket[]
  outboundFiat: OpsTreasuryMovementBucket[]
}

export type OpsTreasuryMovementEvent = {
  amount: number
  at: Date
  currency: string
  direction: 'IN' | 'OUT'
  kind: 'BRIDGE_SETTLED' | 'CRYPTO_IN' | 'FIAT_PAYOUT'
  reference: string
}

export type OpsTreasuryMovementsResponse = {
  days: OpsTreasuryMovementDay[]
  recent: OpsTreasuryMovementEvent[]
}

export type OpsTreasurySnapshotPoint = {
  capturedAt: Date
  usdValue: null | number
}

export type OpsTreasurySnapshotSeries = {
  points: OpsTreasurySnapshotPoint[]
  venue: string
}

export type OpsTreasurySnapshotsResponse = {
  from: Date
  series: OpsTreasurySnapshotSeries[]
  to: Date
}

export type OpsTreasuryVenueError = {
  message: string
  venue: string
}

export type TreasurySnapshotCaptureResult = {
  cells: number
  errors: OpsTreasuryVenueError[]
  skipped: boolean
}

const BALANCES_CACHE_TTL_MS_DEFAULT = 60_000
const DEFAULT_MOVEMENT_DAYS = 14
const DEFAULT_SNAPSHOT_DAYS = 7
const DEFAULT_SNAPSHOT_RETENTION_DAYS = 180
const MAX_WINDOW_DAYS = 90
const RECENT_EVENT_LIMIT = 25
const SOURCE_TIMEOUT_MS = 8_000
const USD_STABLES = new Set<string>([CryptoCurrency.USDC, CryptoCurrency.USDT])

/**
 * Read model for the ops treasury dashboard: live balances fanned out across
 * every venue, an indicative USD roll-up, movement aggregates reconstructed
 * from the transaction/bridge ledgers, and the snapshot history series. Pure
 * reads — per-venue failures degrade to an error chip instead of failing the
 * whole board, and results are briefly cached so dashboard polling cannot
 * hammer the venue APIs.
 */
@injectable()
export class OpsTreasuryService {
  private balancesCache?: { at: number, value: OpsTreasuryBalancesResponse }
  private readonly cacheTtlMs: number
  private readonly logger: ScopedLogger
  private readonly retentionDays: number

  constructor(
    @multiInject(TYPES.ITreasuryBalanceSource) private readonly sources: ITreasuryBalanceSource[],
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(BridgeFloatService) private readonly floatService: BridgeFloatService,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.cacheTtlMs = this.readNumber('TREASURY_BALANCES_CACHE_MS', BALANCES_CACHE_TTL_MS_DEFAULT)
    this.retentionDays = this.readNumber('TREASURY_SNAPSHOT_RETENTION_DAYS', DEFAULT_SNAPSHOT_RETENTION_DAYS)
    this.logger = createScopedLogger(baseLogger, { scope: 'OpsTreasury' })
  }

  public async captureSnapshot(): Promise<TreasurySnapshotCaptureResult> {
    const balances = await this.loadBalances()
    if (balances.errors.length >= this.sources.length) {
      // Every venue failed — a snapshot of nothing but zeros would poison the
      // history series, so skip the tick entirely.
      this.logger.warn('Skipping treasury snapshot: all venues errored', { errors: balances.errors })
      return { cells: 0, errors: balances.errors, skipped: true }
    }

    const client = await this.dbProvider.getClient()
    await client.treasuryBalanceSnapshot.createMany({
      data: balances.cells.map(cell => ({
        account: cell.account,
        amount: cell.amount,
        capturedAt: balances.capturedAt,
        currency: cell.currency,
        usdRate: cell.usdRate,
        usdValue: cell.usdValue,
        venue: cell.venue,
      })),
    })

    // Retention: hourly ticks accumulate forever otherwise. Best-effort — a
    // prune failure must not fail the capture.
    try {
      const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000)
      await client.treasuryBalanceSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } })
    }
    catch (error) {
      this.logger.warn('Treasury snapshot retention prune failed', { message: this.sanitizeErrorMessage(error) })
    }

    return { cells: balances.cells.length, errors: balances.errors, skipped: false }
  }

  public async getBalances(): Promise<OpsTreasuryBalancesResponse> {
    const now = Date.now()
    if (this.balancesCache && now - this.balancesCache.at < this.cacheTtlMs) {
      return this.balancesCache.value
    }
    const value = await this.loadBalances()
    this.balancesCache = { at: now, value }
    return value
  }

  public async getMovements(days?: number): Promise<OpsTreasuryMovementsResponse> {
    const windowDays = this.clampDays(days, DEFAULT_MOVEMENT_DAYS)
    // Align to the start of the oldest UTC day so every bucket is a full
    // calendar day and the window spans exactly windowDays dates.
    const since = new Date(Date.now() - (windowDays - 1) * 24 * 60 * 60 * 1000)
    since.setUTCHours(0, 0, 0, 0)
    const client = await this.dbProvider.getClient()

    const [transactions, settledBatches] = await Promise.all([
      client.transaction.findMany({
        select: {
          createdAt: true,
          id: true,
          quote: {
            select: {
              cryptoCurrency: true,
              sourceAmount: true,
              targetAmount: true,
              targetCurrency: true,
            },
          },
        },
        where: { createdAt: { gte: since }, status: 'PAYMENT_COMPLETED' },
      }),
      client.bridgeBatch.findMany({
        select: { grossAmount: true, id: true, settledAt: true },
        where: { settledAt: { gte: since } },
      }),
    ])

    const dayMap = new Map<string, OpsTreasuryMovementDay>()
    const dayFor = (at: Date): OpsTreasuryMovementDay => {
      const key = at.toISOString().slice(0, 10)
      let day = dayMap.get(key)
      if (!day) {
        day = { bridgeSettledUsdc: 0, date: key, inboundCrypto: [], outboundFiat: [] }
        dayMap.set(key, day)
      }
      return day
    }
    const bump = (buckets: OpsTreasuryMovementBucket[], currency: string, amount: number): void => {
      const bucket = buckets.find(entry => entry.currency === currency)
      if (bucket) {
        bucket.amount += amount
      }
      else {
        buckets.push({ amount, currency })
      }
    }

    const events: OpsTreasuryMovementEvent[] = []

    for (const transaction of transactions) {
      const day = dayFor(transaction.createdAt)
      bump(day.inboundCrypto, transaction.quote.cryptoCurrency, transaction.quote.sourceAmount)
      bump(day.outboundFiat, transaction.quote.targetCurrency, transaction.quote.targetAmount)
      events.push({
        amount: transaction.quote.sourceAmount,
        at: transaction.createdAt,
        currency: transaction.quote.cryptoCurrency,
        direction: 'IN',
        kind: 'CRYPTO_IN',
        reference: transaction.id,
      })
      events.push({
        amount: transaction.quote.targetAmount,
        at: transaction.createdAt,
        currency: transaction.quote.targetCurrency,
        direction: 'OUT',
        kind: 'FIAT_PAYOUT',
        reference: transaction.id,
      })
    }

    for (const batch of settledBatches) {
      if (!batch.settledAt) continue
      dayFor(batch.settledAt).bridgeSettledUsdc += batch.grossAmount
      events.push({
        amount: batch.grossAmount,
        at: batch.settledAt,
        currency: CryptoCurrency.USDC,
        direction: 'OUT',
        kind: 'BRIDGE_SETTLED',
        reference: batch.id,
      })
    }

    // Fill empty days so charts render a continuous axis.
    for (let offset = 0; offset < windowDays; offset += 1) {
      dayFor(new Date(Date.now() - offset * 24 * 60 * 60 * 1000))
    }

    return {
      days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      recent: events
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, RECENT_EVENT_LIMIT),
    }
  }

  public async getSnapshots(days?: number): Promise<OpsTreasurySnapshotsResponse> {
    const windowDays = this.clampDays(days, DEFAULT_SNAPSHOT_DAYS)
    const to = new Date()
    const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000)
    const client = await this.dbProvider.getClient()

    const rows = await client.treasuryBalanceSnapshot.findMany({
      orderBy: { capturedAt: 'asc' },
      select: { capturedAt: true, usdValue: true, venue: true },
      where: { capturedAt: { gte: from } },
    })

    // One point per (venue, capture tick): captures share the exact capturedAt
    // written by captureSnapshot, so the timestamp is a safe group key.
    const seriesMap = new Map<string, Map<number, { hasValue: boolean, sum: number }>>()
    for (const row of rows) {
      let venueSeries = seriesMap.get(row.venue)
      if (!venueSeries) {
        venueSeries = new Map()
        seriesMap.set(row.venue, venueSeries)
      }
      const tick = row.capturedAt.getTime()
      const point = venueSeries.get(tick) ?? { hasValue: false, sum: 0 }
      if (row.usdValue !== null) {
        point.hasValue = true
        point.sum += row.usdValue
      }
      venueSeries.set(tick, point)
    }

    const series: OpsTreasurySnapshotSeries[] = [...seriesMap.entries()]
      .map(([venue, ticks]) => ({
        points: [...ticks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([tick, point]) => ({
            capturedAt: new Date(tick),
            usdValue: point.hasValue ? point.sum : null,
          })),
        venue,
      }))
      .sort((a, b) => a.venue.localeCompare(b.venue))

    return { from, series, to }
  }

  private clampDays(days: number | undefined, fallback: number): number {
    if (days === undefined || !Number.isFinite(days)) return fallback
    return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.trunc(days)))
  }

  private async fetchFxRates(currencies: string[]): Promise<{ errors: string[], rates: Map<string, number> }> {
    const rates = new Map<string, number>()
    const errors: string[] = []

    for (const currency of currencies) {
      if (USD_STABLES.has(currency)) {
        rates.set(currency, 1)
        continue
      }
      if (currency !== TargetCurrency.BRL && currency !== TargetCurrency.COP) {
        continue
      }
      try {
        const provider = this.exchangeProviderFactory.getExchangeProvider(currency)
        // Providers quote crypto-per-fiat — USD(C) per 1 fiat unit, the same
        // direction quoteUseCase consumes — so the rate IS usdPerUnit
        // (e.g. ~0.00024 for COP, ~0.185 for BRL). Do NOT invert it.
        const rate = await this.withTimeout(provider.getExchangeRate({
          sourceAmount: 1,
          sourceCurrency: CryptoCurrency.USDC,
          targetCurrency: currency,
        }), SOURCE_TIMEOUT_MS, `FX rate for ${currency}`)
        if (Number.isFinite(rate) && rate > 0) {
          rates.set(currency, rate)
        }
        else {
          errors.push(`FX rate for ${currency} was not a positive number`)
        }
      }
      catch (error) {
        errors.push(`FX rate for ${currency} unavailable: ${this.sanitizeErrorMessage(error)}`)
      }
    }

    return { errors, rates }
  }

  private async loadBalances(): Promise<OpsTreasuryBalancesResponse> {
    const capturedAt = new Date()
    const errors: OpsTreasuryVenueError[] = []

    const settled = await Promise.all(this.sources.map(async (source) => {
      try {
        return await this.withTimeout(source.getBalances(), SOURCE_TIMEOUT_MS, source.venue)
      }
      catch (error) {
        const message = this.sanitizeErrorMessage(error)
        this.logger.warn('Treasury venue read failed', { message, venue: source.venue })
        errors.push({ message, venue: source.venue })
        return []
      }
    }))

    const raw = settled.flat()
    const currencies = [...new Set(raw.map(balance => balance.currency))]
    const fx = await this.fetchFxRates(currencies)

    const cells: OpsTreasuryBalanceCell[] = raw.map((balance) => {
      const usdRate = fx.rates.get(balance.currency) ?? null
      return {
        account: balance.account,
        amount: balance.amount,
        currency: balance.currency,
        usdRate,
        usdValue: usdRate === null ? null : balance.amount * usdRate,
        venue: balance.venue,
      }
    })

    const totalUsd = cells.reduce((sum, cell) => sum + (cell.usdValue ?? 0), 0)
    const hasUnpriced = cells.some(cell => cell.usdValue === null && cell.amount !== 0)

    const deficit = await this.floatService.getOutstandingDeficit(CryptoCurrency.USDC)
    const cap = this.floatService.getCapUsdc() ?? null

    return {
      capturedAt,
      cells,
      errors,
      float: {
        available: cap === null ? null : cap - deficit,
        cap,
        deficit,
        enabled: cap !== null,
      },
      fxRates: [...fx.rates.entries()]
        .filter(([currency]) => !USD_STABLES.has(currency))
        .map(([currency, usdPerUnit]) => ({ currency, usdPerUnit }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      totalUsd,
      totalUsdIsPartial: errors.length > 0 || hasUnpriced || fx.errors.length > 0,
    }
  }

  private readNumber(envKey: string, fallback: number): number {
    const raw = process.env[envKey]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  // Provider/SDK error messages can embed secrets (ethers v5 puts the RPC URL
  // in JsonRpcProvider errors; axios messages can carry full request URLs).
  // These strings flow into the ops API response, so strip URLs and cap length.
  private sanitizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : 'unknown error'
    return message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]').slice(0, 200)
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, venue: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${venue} balance read timed out after ${ms}ms`)), ms)
        }),
      ])
    }
    finally {
      if (timer) clearTimeout(timer)
    }
  }
}
