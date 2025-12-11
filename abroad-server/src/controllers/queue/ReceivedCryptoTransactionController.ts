// src/controllers/queue/StellarReceivedCryptoTransactionController.ts
import { inject } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { TYPES } from '../../types'
import { IReceivedCryptoTransactionUseCase } from '../../useCases/receivedCryptoTransactionUseCase'

export class ReceivedCryptoTransactionController {
  private readonly logPrefix = '[ReceivedCryptoTransaction]'

  public constructor(
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.ReceivedCryptoTransactionUseCase)
    private readonly receivedCryptoTransactionUseCase: IReceivedCryptoTransactionUseCase,
  ) { }

  public registerConsumers() {
    try {
      this.logger.info(
        `${this.logPrefix}: Registering consumer for queue:`,
        QueueName.RECEIVED_CRYPTO_TRANSACTION,
      )
      void this.queueHandler.subscribeToQueue(
        QueueName.RECEIVED_CRYPTO_TRANSACTION,
        this.receivedCryptoTransactionUseCase.process.bind(this.receivedCryptoTransactionUseCase),
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
