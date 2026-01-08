import { inject } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { IPaymentSentUseCase } from '../../application/paymentSentUseCase'

export class PaymentSentController {
  private readonly logPrefix = '[PaymentSent]'

  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.PaymentSentUseCase) private readonly paymentSentUseCase: IPaymentSentUseCase,
  ) {

  }

  public registerConsumers() {
    try {
      this.logger.info(
        `${this.logPrefix}: Registering consumer for queue:`,
        QueueName.PAYMENT_SENT,
      )
      void this.queueHandler.subscribeToQueue(
        QueueName.PAYMENT_SENT,
        this.onPaymentSent.bind(this),
      )
    }
    catch (error) {
      this.logger.error(
        `${this.logPrefix}: Error in consumer registration:`,
        error,
      )
    }
  }

  private async onPaymentSent(msg: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'PaymentSent queue',
    })

    try {
      await this.paymentSentUseCase.process(msg)
    }
    catch (error) {
      scopedLogger.error('[PaymentSent queue]: Error processing payment sent message', error)
      throw error
    }
  }
}
