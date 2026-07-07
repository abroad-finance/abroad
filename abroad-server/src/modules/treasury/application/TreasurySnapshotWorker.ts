import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { OpsTreasuryService } from './OpsTreasuryService'

type TreasurySnapshotWorkerOptions = {
  pollIntervalMs?: number
}

/**
 * Periodically captures a treasury balance snapshot so the ops dashboard can
 * chart balances over time. The first capture runs at startup, so history
 * starts accruing on deploy. A tick failure is logged and never breaks the
 * loop; captureSnapshot itself skips ticks where every venue errored.
 */
@injectable()
export class TreasurySnapshotWorker {
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number
  private wake: (() => void) | null = null

  public constructor(
    @inject(OpsTreasuryService) private readonly treasuryService: OpsTreasuryService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: TreasurySnapshotWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? this.readNumber('TREASURY_SNAPSHOT_INTERVAL_MS', 3_600_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'TreasurySnapshotWorker' })
  }

  public async runOnce(): Promise<void> {
    try {
      const result = await this.treasuryService.captureSnapshot()
      if (result.skipped) {
        this.logger.warn('Treasury snapshot skipped', { errors: result.errors })
      }
      else {
        this.logger.info('Treasury snapshot captured', { cells: result.cells, venueErrors: result.errors.length })
      }
    }
    catch (error) {
      this.logger.error('Treasury snapshot tick failed', error)
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.loopPromise = this.loop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    this.wake?.()
    if (this.loopPromise) {
      await this.loopPromise
    }
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      await this.runOnce()
      // stop() may have landed during the capture (when no wake was armed) —
      // re-check before sleeping or shutdown would wait out the full interval.
      if (!this.isRunning) break
      await this.sleep(this.pollIntervalMs)
    }
  }

  private readNumber(envKey: string, fallback: number): number {
    const raw = process.env[envKey]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  // Interruptible: stop() resolves the pending sleep immediately so shutdown
  // never waits out the (long) snapshot interval.
  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    this.wake = null
  }
}
