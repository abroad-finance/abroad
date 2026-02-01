import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ValidationError } from '../../../../core/errors'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { BinanceBalanceUpdatedMessageSchema } from '../../../../platform/messaging/queueSchema'
import { FlowOrchestrator } from '../../../flows/application/FlowOrchestrator'

/**
 * Listens for balance‑update events from Binance and emits flow signals
 * so waiting exchange steps can resume.
 */
@injectable()
export class BinanceBalanceUpdatedController {
  constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
  ) {}

  public registerConsumers(): void {
    this.logger.info(
      '[BinanceBalanceUpdated queue]: Registering consumer for queue:',
      QueueName.BINANCE_BALANCE_UPDATED,
    )
    this.queueHandler.subscribeToQueue(
      QueueName.BINANCE_BALANCE_UPDATED,
      this.onBalanceUpdated.bind(this),
    )
  }

  private async onBalanceUpdated(message: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'BinanceBalanceUpdated queue',
    })

    const parsed = BinanceBalanceUpdatedMessageSchema.safeParse(message)
    if (!parsed.success) {
      scopedLogger.error('[BinanceBalanceUpdated queue]: Invalid message format', parsed.error)
      throw new ValidationError('Invalid binance balance update message', parsed.error.issues)
    }

    try {
      await this.orchestrator.handleSignal({
        correlationKeys: { provider: 'binance' },
        eventType: 'exchange.balance.updated',
        payload: { provider: 'binance' },
      })
    }
    catch (error) {
      scopedLogger.error('Error processing balance update signal', error)
      throw error
    }
  }
}
