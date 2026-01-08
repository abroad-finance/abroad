import { inject } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { PaymentStatusUpdatedMessage, PaymentStatusUpdatedMessageSchema } from '../../../../platform/messaging/queueSchema'
import { TransactionWorkflow } from '../../../transactions/application/TransactionWorkflow'

/**
 * Consumes payment status update messages coming from providers like Transfero
 * and delegates processing to the transaction workflow.
 */
export class PaymentStatusUpdatedController {
  public constructor(
    @inject(TYPES.TransactionWorkflow) private readonly workflow: TransactionWorkflow,
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
      throw new Error('Invalid payment status update message')
    }
    const message: PaymentStatusUpdatedMessage = parsed.data

    try {
      await this.workflow.handleProviderStatusUpdate(message)
    }
    catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      scopedLogger.error('[PaymentStatusUpdated queue]: Error updating transaction:', normalizedError)
      throw normalizedError
    }
  }
}
