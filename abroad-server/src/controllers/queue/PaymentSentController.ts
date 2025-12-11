import { inject } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { TYPES } from '../../types'
import { IPaymentSentUseCase } from '../../useCases/paymentSentUseCase'

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

  private async onPaymentSent(msg: Record<string, boolean | number | string>): Promise<void> {
    await this.paymentSentUseCase.process(msg)
  }
}
