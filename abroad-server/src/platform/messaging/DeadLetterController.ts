import { inject, injectable } from 'inversify'

import { TYPES } from '../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../core/logging/scopedLogger'
import { ILogger } from '../../core/logging/types'
import { IQueueHandler, QueueName } from './queues'
import { DeadLetterMessageSchema } from './queueSchema'

@injectable()
export class DeadLetterController {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'DeadLetterController' })
  }

  public registerConsumers(): void {
    try {
      this.logger.info('[DeadLetter] Registering consumer for dead-letter queue')
      void this.queueHandler.subscribeToQueue(
        QueueName.DEAD_LETTER,
        this.onDeadLetter.bind(this),
        `${QueueName.DEAD_LETTER}-consumer`,
      )
    }
    catch (error) {
      this.logger.error('[DeadLetter] Failed to register consumer', error)
    }
  }

  private onDeadLetter(message: unknown): void {
    const parsed = DeadLetterMessageSchema.safeParse(message)
    if (!parsed.success) {
      this.logger.warn('[DeadLetter] Invalid message received', parsed.error.issues)
      return
    }

    const dlqMessage = parsed.data
    const scopedLogger = this.logger.child({
      staticPayload: {
        originalQueue: dlqMessage.originalQueue,
        reason: dlqMessage.reason,
      },
    })

    scopedLogger.warn('Dead-letter message received', {
      error: dlqMessage.error,
      payloadPreview: this.previewPayload(dlqMessage.payload),
    })
  }

  private previewPayload(payload: unknown): string {
    try {
      const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload)
      return serialized.length > 500 ? `${serialized.substring(0, 500)}…` : serialized
    }
    catch {
      return '[unserializable]'
    }
  }
}
