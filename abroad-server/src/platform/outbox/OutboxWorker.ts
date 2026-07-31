import { inject, injectable } from 'inversify'

import { TYPES } from '../../app/container/types'
import { createScopedLogger } from '../../core/logging/scopedLogger'
import { ILogger } from '../../core/logging/types'
import { OutboxDispatcher } from './OutboxDispatcher'
import { OutboxRecord, OutboxRepository } from './OutboxRepository'

type OutboxWorkerOptions = {
  batchSize?: number
  pollIntervalMs?: number
}

const FAILURE_REPORT_INTERVAL_MS = 60_000

@injectable()
export class OutboxWorker {
  private readonly batchSize: number
  private isRunning = false
  private lastFailureReportAt = 0
  private readonly logger: ReturnType<typeof createScopedLogger>
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number

  public constructor(
    @inject(OutboxRepository) private readonly repository: OutboxRepository,
    @inject(TYPES.IOutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: OutboxWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? this.readNumber('OUTBOX_BATCH_SIZE', 50)
    this.pollIntervalMs = options.pollIntervalMs ?? this.readNumber('OUTBOX_POLL_INTERVAL_MS', 1_000)
    this.logger = createScopedLogger(baseLogger, { scope: 'OutboxWorker' })
  }

  public async reportFailures(): Promise<void> {
    const summary = await this.repository.summarizeFailures()
    if (summary.failed === 0 && summary.delivering === 0) {
      return
    }

    const now = Date.now()
    if (now - this.lastFailureReportAt < FAILURE_REPORT_INTERVAL_MS) {
      return
    }
    this.lastFailureReportAt = now

    this.logger.warn('Outbox failure backlog detected', summary)
  }

  public async runOnce(): Promise<void> {
    const batch = await this.repository.nextBatch(this.batchSize)
    await Promise.all(batch.map(record => this.deliver(record)))
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

  private async deliver(record: OutboxRecord): Promise<void> {
    try {
      await this.dispatcher.deliver(record, 'outbox-worker')
    }
    catch (error) {
      this.logger.error('Failed delivering outbox record', { error, recordId: record.id })
    }
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.runOnce()
        await this.reportFailures()
      }
      catch (error) {
        this.logger.error('Error processing outbox batch', error)
      }
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
