import { inject, injectable } from 'inversify'

import type {
  TransparencyMetricsResponse,
  TransparencyOpenSourceMetrics,
  TransparencyOpenSourceSnapshot,
  TransparencyPlatformMetrics,
  TransparencyPlatformSnapshot,
} from './transparencyContracts'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PublicCorridorService } from '../../flows/application/PublicCorridorService'
import { TransparencyCache } from './transparencyCache'
import { readTransparencyOpenSourceMetrics, unavailableTransparencyOpenSourceMetrics } from './transparencyOpenSourceMetrics'
import { readTransparencyPlatformMetrics } from './transparencyPlatformMetrics'

const DEFAULT_GITHUB_CACHE_TTL_MS = 15 * 60 * 1000
const DEFAULT_PLATFORM_CACHE_TTL_MS = 60 * 1000
const GITHUB_MAX_STALE_MS = 24 * 60 * 60 * 1000
const PLATFORM_MAX_STALE_MS = 10 * 60 * 1000

@injectable()
export class TransparencyMetricsService {
  private readonly githubCache: TransparencyCache<TransparencyOpenSourceSnapshot>
  private readonly githubTtlMs: number
  private readonly platformCache: TransparencyCache<TransparencyPlatformSnapshot>
  private readonly platformTtlMs: number

  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(PublicCorridorService)
    private readonly corridorService: PublicCorridorService,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) {
    this.githubTtlMs = this.readPositiveInteger(
      'TRANSPARENCY_GITHUB_CACHE_TTL_MS',
      DEFAULT_GITHUB_CACHE_TTL_MS,
    )
    this.platformTtlMs = this.readPositiveInteger(
      'TRANSPARENCY_PLATFORM_CACHE_TTL_MS',
      DEFAULT_PLATFORM_CACHE_TTL_MS,
    )
    this.githubCache = new TransparencyCache(this.githubTtlMs)
    this.platformCache = new TransparencyCache(this.platformTtlMs)
  }

  public async getMetrics(): Promise<TransparencyMetricsResponse> {
    const [platform, openSource] = await Promise.all([
      this.getPlatformMetrics(),
      this.getOpenSourceMetrics(),
    ])

    return {
      generatedAt: new Date().toISOString(),
      openSource,
      platform,
      refreshAfterSeconds: Math.max(1, Math.ceil(this.platformTtlMs / 1000)),
      schemaVersion: '1.0',
    }
  }

  private async getOpenSourceMetrics(): Promise<TransparencyOpenSourceMetrics> {
    const now = Date.now()
    const fresh = this.githubCache.getFresh(now)
    if (fresh) return { ...fresh, cache: 'fresh' }

    try {
      const snapshot = await this.githubCache.refresh(
        readTransparencyOpenSourceMetrics,
      )
      return { ...snapshot, cache: 'fresh' }
    }
    catch (error) {
      this.logRefreshFailure('GitHub', error)
      const stale = this.githubCache.getWithin(GITHUB_MAX_STALE_MS, now)
      return stale
        ? { ...stale, cache: 'stale' }
        : unavailableTransparencyOpenSourceMetrics()
    }
  }

  private async getPlatformMetrics(): Promise<TransparencyPlatformMetrics> {
    const now = Date.now()
    const fresh = this.platformCache.getFresh(now)
    if (fresh) return { ...fresh, cache: 'fresh' }

    try {
      const snapshot = await this.platformCache.refresh(async () => {
        const client = await this.dbProvider.getClient()
        return readTransparencyPlatformMetrics(client, this.corridorService)
      })
      return { ...snapshot, cache: 'fresh' }
    }
    catch (error) {
      const stale = this.platformCache.getWithin(PLATFORM_MAX_STALE_MS, now)
      if (!stale) throw error

      this.logRefreshFailure('platform', error)
      return { ...stale, cache: 'stale' }
    }
  }

  private logRefreshFailure(source: string, error: unknown): void {
    this.logger.warn('[TransparencyMetricsService] Refresh failed', {
      reason: error instanceof Error ? error.message : 'Unknown error',
      source,
    })
  }

  private readPositiveInteger(key: string, fallback: number): number {
    const parsed = Number(process.env[key])
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
  }
}
