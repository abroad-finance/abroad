import { Country, PaymentMethod } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export type LiquidityCacheResult = {
  fromCache: boolean
  liquidity: number
  message?: string
  stale?: boolean
  success: boolean
}

type CachedLiquidity = {
  liquidity: number
  updatedAt: Date
}

type GetLiquidityParams = {
  fetchLiquidity: () => Promise<number>
  method: PaymentMethod
  now?: number
}

type PrismaClientLike = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

@injectable()
export class LiquidityCacheService {
  private readonly inFlightRefreshes: Map<PaymentMethod, Promise<void>> = new Map()
  private readonly maxStaleMs: number
  private readonly syncFetchTimeoutMs: number
  private readonly ttlMs: number

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    this.ttlMs = this.readNumberFromEnv('LIQUIDITY_CACHE_TTL_MS', 5 * 60 * 1000)
    this.maxStaleMs = this.readNumberFromEnv('LIQUIDITY_CACHE_MAX_STALE_MS', 60 * 60 * 1000)
    this.syncFetchTimeoutMs = this.readNumberFromEnv('LIQUIDITY_CACHE_SYNC_FETCH_TIMEOUT_MS', 5_000)
  }

  public async getLiquidity(params: GetLiquidityParams): Promise<LiquidityCacheResult> {
    const prisma = await this.dbClientProvider.getClient()
    const now = params.now ?? Date.now()
    const cached = await this.readCachedLiquidity(prisma, params.method)

    if (cached) {
      const ageMs = now - cached.updatedAt.getTime()
      if (ageMs <= this.ttlMs) {
        return { fromCache: true, liquidity: cached.liquidity, success: true }
      }
      if (ageMs <= this.maxStaleMs) {
        this.scheduleBackgroundRefresh(prisma, params)
        return { fromCache: true, liquidity: cached.liquidity, stale: true, success: true }
      }
    }

    return this.syncFetchAndCache(prisma, params, cached)
  }

  private async deduplicatedRefresh(prisma: PrismaClientLike, params: GetLiquidityParams): Promise<void> {
    const existing = this.inFlightRefreshes.get(params.method)
    if (existing) {
      await existing
      return
    }
    // The map entry is always a no-op-on-error promise so any concurrent
    // observer can safely await it without triggering an unhandled rejection.
    // This caller awaits the raw refresh below so the error still propagates.
    const refreshPromise = this.refreshCache(prisma, params)
    const guardedEntry = refreshPromise.catch(() => undefined).finally(() => {
      this.inFlightRefreshes.delete(params.method)
    })
    this.inFlightRefreshes.set(params.method, guardedEntry)
    await refreshPromise
  }

  private async readCachedLiquidity(prisma: PrismaClientLike, method: PaymentMethod): Promise<CachedLiquidity | null> {
    const record = await prisma.paymentProvider.findUnique({ where: { id: method } })
    if (!record) {
      await prisma.paymentProvider.create({
        data: {
          country: Country.CO,
          id: method,
          liquidity: 0,
          name: method,
        },
      })
      return null
    }
    if (!(record.liquidity > 0) || !record.updatedAt) {
      return null
    }
    return { liquidity: record.liquidity, updatedAt: record.updatedAt }
  }

  private readNumberFromEnv(key: string, fallback: number): number {
    const raw = process.env[key]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private async refreshCache(prisma: PrismaClientLike, params: GetLiquidityParams): Promise<void> {
    const refreshed = await this.withTimeout(params.fetchLiquidity(), this.syncFetchTimeoutMs)
    if (!Number.isFinite(refreshed)) {
      throw new Error('Provider returned an invalid liquidity value')
    }
    await prisma.paymentProvider.update({
      data: { liquidity: refreshed },
      where: { id: params.method },
    })
  }

  private scheduleBackgroundRefresh(prisma: PrismaClientLike, params: GetLiquidityParams): void {
    if (this.inFlightRefreshes.has(params.method)) return
    const promise = this.refreshCache(prisma, params)
      .catch((error) => {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        this.logger.warn('[LiquidityCacheService] Background refresh failed', { method: params.method, reason })
      })
      .finally(() => {
        this.inFlightRefreshes.delete(params.method)
      })
    this.inFlightRefreshes.set(params.method, promise)
  }

  private async syncFetchAndCache(
    prisma: PrismaClientLike,
    params: GetLiquidityParams,
    cached: CachedLiquidity | null,
  ): Promise<LiquidityCacheResult> {
    try {
      await this.deduplicatedRefresh(prisma, params)
      const fresh = await this.readCachedLiquidity(prisma, params.method)
      if (fresh) {
        return { fromCache: false, liquidity: fresh.liquidity, success: true }
      }
      return {
        fromCache: cached !== null,
        liquidity: cached?.liquidity ?? 0,
        message: 'Refresh produced no usable value',
        success: false,
      }
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error('[LiquidityCacheService] Sync liquidity fetch failed', { method: params.method, reason })
      return {
        fromCache: cached !== null,
        liquidity: cached?.liquidity ?? 0,
        message: reason,
        success: false,
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Liquidity fetch timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }
}
