import { Country, PaymentMethod } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

type GetLiquidityParams = {
  fetchLiquidity: () => Promise<number>
  method: PaymentMethod
  now?: number
}

type LiquidityCacheResult = {
  fromCache: boolean
  liquidity: number
  message?: string
  success: boolean
}

@injectable()
export class LiquidityCacheService {
  private readonly ttlMs: number

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    this.ttlMs = this.readNumberFromEnv('LIQUIDITY_CACHE_TTL_MS', 5 * 60 * 1000)
  }

  public async getLiquidity(params: GetLiquidityParams): Promise<LiquidityCacheResult> {
    const prisma = await this.dbClientProvider.getClient()
    const now = params.now ?? Date.now()
    const providerRecord = await prisma.paymentProvider.findUnique({ where: { id: params.method } })

    if (!providerRecord) {
      await prisma.paymentProvider.create({
        data: {
          country: Country.CO,
          id: params.method,
          liquidity: 0,
          name: params.method,
        },
      })
    }

    const lastUpdatedAt = providerRecord?.updatedAt?.getTime()
    const cachedLiquidity = providerRecord?.liquidity ?? 0
    const isFresh = cachedLiquidity > 0 && typeof lastUpdatedAt === 'number' && now - lastUpdatedAt <= this.ttlMs

    if (isFresh) {
      return { fromCache: true, liquidity: cachedLiquidity, success: true }
    }

    try {
      const refreshedLiquidity = await params.fetchLiquidity()
      if (Number.isFinite(refreshedLiquidity)) {
        await prisma.paymentProvider.update({
          data: { liquidity: refreshedLiquidity },
          where: { id: params.method },
        })
        return { fromCache: false, liquidity: refreshedLiquidity, success: true }
      }
      return {
        fromCache: cachedLiquidity > 0,
        liquidity: cachedLiquidity,
        message: 'Provider returned an invalid liquidity value',
        success: false,
      }
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error('[LiquidityCacheService] Failed to refresh liquidity', reason)
      return { fromCache: cachedLiquidity > 0, liquidity: cachedLiquidity, message: reason, success: false }
    }
  }

  private readNumberFromEnv(key: string, fallback: number): number {
    const raw = process.env[key]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
}
