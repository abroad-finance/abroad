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

@injectable()
export class OutboxWorker {
  private isRunning = false
  private loopPromise: Promise<void> | null = null
  private readonly batchSize: number
  private readonly logger: ReturnType<typeof createScopedLogger>
  private readonly pollIntervalMs: number

  public constructor(
    @inject(OutboxRepository) private readonly repository: OutboxRepository,
    @inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: OutboxWorkerOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 50
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    this.logger = createScopedLogger(baseLogger, { scope: 'OutboxWorker' })
  }

  public async runOnce(): Promise<void> {
    const batch = await this.repository.nextBatch(this.batchSize)
    await Promise.all(batch.map((record) => this.deliver(record)))
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
      try {
        await this.runOnce()
      }
      catch (error) {
        this.logger.error('Error processing outbox batch', error)
      }
      await this.sleep(this.pollIntervalMs)
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

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}
