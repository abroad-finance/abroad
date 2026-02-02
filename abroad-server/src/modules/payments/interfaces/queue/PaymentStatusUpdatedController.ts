import { inject } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ValidationError } from '../../../../core/errors'
import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { PaymentStatusUpdatedMessage, PaymentStatusUpdatedMessageSchema } from '../../../../platform/messaging/queueSchema'
import { FlowOrchestrator } from '../../../flows/application/FlowOrchestrator'

/**
 * Consumes payment status update messages coming from providers like Transfero
 * and delegates processing to the flow orchestrator.
 */
export class PaymentStatusUpdatedController {
  public constructor(
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) { }

  public registerConsumers() {
    try {
      this.logger.info('[PaymentStatusUpdated queue]: Registering consumer for queue:', QueueName.PAYMENT_STATUS_UPDATED)
      void this.queueHandler.subscribeToQueue(
        QueueName.PAYMENT_STATUS_UPDATED,
        this.onPaymentStatusUpdated.bind(this),
      )
    }
    catch (error) {
      this.logger.error('[PaymentStatusUpdated queue]: Error in consumer registration:', error)
    }
  }

  private async onPaymentStatusUpdated(msg: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'PaymentStatusUpdated queue',
    })

    const parsed = PaymentStatusUpdatedMessageSchema.safeParse(msg)
    if (!parsed.success) {
      scopedLogger.error('[PaymentStatusUpdated queue]: Invalid message format:', parsed.error)
      throw new ValidationError('Invalid payment status update message', parsed.error.issues)
    }
    const message: PaymentStatusUpdatedMessage = parsed.data

    try {
      await this.orchestrator.handleSignal({
        correlationKeys: { externalId: message.externalId },
        eventType: 'payment.status.updated',
        payload: {
          amount: message.amount ?? 0,
          currency: message.currency,
          externalId: message.externalId,
          provider: message.provider,
          status: message.status,
        },
      })
    }
    catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      scopedLogger.error('[PaymentStatusUpdated queue]: Error updating flow:', normalizedError)
      throw normalizedError
    }
  }
}
