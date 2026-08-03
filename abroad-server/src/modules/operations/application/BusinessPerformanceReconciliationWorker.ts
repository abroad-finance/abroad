import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { BusinessPerformanceReconciliationService } from './BusinessPerformanceReconciliationService'

const DEFAULT_INTERVAL_MS = 5 * 60_000
const DEFAULT_BACKFILL_INTERVAL_MS = 60_000

@injectable()
export class BusinessPerformanceReconciliationWorker {
  private readonly backfillIntervalMs: number
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number
  private sleepResolver: (() => void) | null = null
  private sleepTimer: null | ReturnType<typeof setTimeout> = null

  public constructor(
    @inject(BusinessPerformanceReconciliationService)
    private readonly service: BusinessPerformanceReconciliationService,
    @inject(TYPES.ILogger)
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'BusinessPerformanceReconciliationWorker' })
    this.backfillIntervalMs = this.readInterval(
      'BUSINESS_PERFORMANCE_BACKFILL_INTERVAL_MS',
      DEFAULT_BACKFILL_INTERVAL_MS,
    )
    this.pollIntervalMs = this.readInterval()
  }

  public async runOnce(): Promise<boolean | null> {
    try {
      const result = await this.service.runBatch()
      this.logger.info('Business performance reconciliation batch completed', result)
      return result.complete
    }
    catch (error) {
      this.logger.error('Business performance reconciliation batch failed', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
      return null
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.loopPromise = this.loop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer)
      this.sleepTimer = null
    }
    const resolveSleep = this.sleepResolver
    this.sleepResolver = null
    resolveSleep?.()
    await this.loopPromise
    this.loopPromise = null
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      const complete = await this.runOnce()
      if (this.isRunning) {
        await this.sleep(complete === false ? this.backfillIntervalMs : this.pollIntervalMs)
      }
    }
  }

  private readInterval(
    name = 'BUSINESS_PERFORMANCE_RECONCILE_INTERVAL_MS',
    fallback = DEFAULT_INTERVAL_MS,
  ): number {
    const raw = process.env[name]
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isRunning) {
        resolve()
        return
      }
      this.sleepResolver = resolve
      this.sleepTimer = setTimeout(() => {
        this.sleepResolver = null
        this.sleepTimer = null
        resolve()
      }, delayMs)
    })
  }
}
