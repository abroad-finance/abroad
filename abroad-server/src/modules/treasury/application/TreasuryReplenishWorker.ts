import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { TreasuryReplenishService } from './TreasuryReplenishService'

type TreasuryReplenishWorkerOptions = {
  pollIntervalMs?: number
}

/**
 * Periodically replenishes the hot wallets that delivered onramps were paid
 * from. The cadence only changes how long Abroad carries the float; every
 * customer involved was paid at delivery time. A tick failure is logged and
 * never breaks the loop, because the enrolled legs stay pending and the next
 * tick picks them up.
 */
@injectable()
export class TreasuryReplenishWorker {
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number

  public constructor(
    @inject(TreasuryReplenishService) private readonly replenishService: TreasuryReplenishService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: TreasuryReplenishWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs
      ?? this.readNumber('TREASURY_REPLENISH_INTERVAL_MS', 300_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'TreasuryReplenishWorker' })
  }

  public async runOnce(): Promise<void> {
    try {
      const result = await this.replenishService.run()
      if (result.batched > 0 || result.bought > 0 || result.withdrawn > 0) {
        this.logger.info('Treasury replenish tick completed', result)
      }
    }
    catch (error) {
      this.logger.error('Treasury replenish tick failed', error)
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.loopPromise = this.loop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    if (this.loopPromise) {
      await this.loopPromise
    }
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      await this.runOnce()
      await this.sleep(this.pollIntervalMs)
    }
  }

  private readNumber(envKey: string, fallback: number): number {
    const raw = process.env[envKey]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}
