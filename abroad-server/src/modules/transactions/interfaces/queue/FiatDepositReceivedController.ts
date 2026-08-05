import { inject } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { IFiatDepositReceivedUseCase } from '../../application/fiatDepositReceivedUseCase'

export class FiatDepositReceivedController {
  private readonly logPrefix = '[FiatDepositReceived]'

  public constructor(
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.FiatDepositReceivedUseCase)
    private readonly fiatDepositReceivedUseCase: IFiatDepositReceivedUseCase,
  ) { }

  public registerConsumers() {
    try {
      this.logger.info(
        `${this.logPrefix}: Registering consumer for queue:`,
        QueueName.FIAT_DEPOSIT_RECEIVED,
      )
      void this.queueHandler.subscribeToQueue(
        QueueName.FIAT_DEPOSIT_RECEIVED,
        this.fiatDepositReceivedUseCase.process.bind(this.fiatDepositReceivedUseCase),
      )
    }
    catch (error) {
      this.logger.error(
        `${this.logPrefix}: Error in consumer registration:`,
        error,
      )
    }
  }
}
