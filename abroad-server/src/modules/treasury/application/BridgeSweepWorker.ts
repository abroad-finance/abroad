import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../platform/messaging/queues'
import { BridgeSweepService } from './BridgeSweepService'

type BridgeSweepWorkerOptions = {
  pollIntervalMs?: number
}

/**
 * Periodically runs the bridge sweep. The cadence only affects how long pooled
 * USDC waits to physically bridge. The customer payout has already completed,
 * while the flow's source-side Ultra reconciliation may remain WAITING until
 * the bridged deposit is consumed. Single-instance (no concurrent sweep); a
 * tick failure is logged and never breaks the loop.
 */
@injectable()
export class BridgeSweepWorker {
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number

  public constructor(
    @inject(BridgeSweepService) private readonly sweepService: BridgeSweepService,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: BridgeSweepWorkerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? this.readNumber('BRIDGE_SWEEP_INTERVAL_MS', 300_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'BridgeSweepWorker' })
  }

  public async runOnce(): Promise<void> {
    try {
      // Reconcile prior submitted batches first (close credited ones, return
      // definitively-failed legs to PENDING), then pool + sweep new legs.
      const reconciled = await this.sweepService.reconcile()
      if (reconciled.credited > 0 || reconciled.failed > 0) {
        this.logger.info('Bridge reconcile completed', reconciled)
      }
      const result = await this.sweepService.sweep()
      if (result.swept) {
        this.logger.info('Bridge sweep completed', result)
      }
    }
    catch (error) {
      this.logger.error('Bridge sweep tick failed', error)
    }

    try {
      // Provider webhooks are the fast path. This periodic signal closes the
      // delivery-order gap where a Polygon deposit is observed before its
      // conversion step has persisted WAITING state, and also recovers a lost
      // webhook without creating another trade or bridge obligation.
      await this.queueHandler.postMessage(
        QueueName.EXCHANGE_BALANCE_UPDATED,
        { provider: 'transfero' },
      )
    }
    catch (error) {
      this.logger.error('Unable to publish periodic Transfero reconciliation signal', error)
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
