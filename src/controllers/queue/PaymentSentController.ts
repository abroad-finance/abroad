import { inject } from 'inversify'

import { ILogger, IQueueHandler, ISlackNotifier, QueueName } from '../../interfaces'
import { IExchangeProvider } from '../../interfaces/IExchangeProvider'
import { IWalletHandlerFactory } from '../../interfaces/IWalletHandlerFactory'
import { PaymentSentMessage, PaymentSentMessageSchema } from '../../interfaces/queueSchema'
import { TYPES } from '../../types'

export class PaymentSentController {
  public constructor(
        @inject(TYPES.ILogger) private logger: ILogger,
        @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
        @inject(TYPES.IWalletHandlerFactory) private walletHandlerFactory: IWalletHandlerFactory,
        @inject(TYPES.IExchangeProvider) private exchangeProvider: IExchangeProvider,
        @inject(TYPES.ISlackNotifier) private slackNotifier: ISlackNotifier,
  ) {

  }

  public registerConsumers() {
    try {
      this.logger.info(
        '[PaymentSent queue]: Registering consumer for queue:',
        QueueName.PAYMENT_SENT,
      )
      this.queueHandler.subscribeToQueue(
        QueueName.RECEIVED_CRYTPO_TRANSACTION,
        this.onPaymentSent.bind(this),
      )
    }
    catch (error) {
      this.logger.error(
        '[PaymentSent queue]: Error in consumer registration:',
        error,
      )
    }
  }

  private async onPaymentSent(msg: Record<string, boolean | number | string>): Promise<void> {
    if (!msg || Object.keys(msg).length === 0) {
      this.logger.warn(
        '[PaymentSent queue]: Received empty message. Skipping...',
      )
      return
    }

    // Validate and parse the message early
    let message: PaymentSentMessage
    try {
      message = PaymentSentMessageSchema.parse(msg)
    }
    catch (error) {
      this.logger.error('[PaymentSent queue]: Invalid message format:', error)
      return
    }

    const { amount, blockchain, cryptoCurrency, targetCurrency } = message

    const walletHandler = this.walletHandlerFactory.getWalletHandler(blockchain)
    const { address, memo } = await this.exchangeProvider.getExchangeAddress({ blockchain, cryptoCurrency })

    const { success, transactionId } = await walletHandler.send({ address, amount, cryptoCurrency, memo })

    if (!success) {
      this.logger.error('[PaymentSent Queue]: Error sending payment:', transactionId)
      this.slackNotifier.sendMessage(
        `[PaymentSent Queue]: Error exchanging ${amount} ${cryptoCurrency} to ${targetCurrency}.`,
      )
      return
    }

    this.logger.info(
      '[PaymentSent Queue]: Payment sent successfully:',
      transactionId,
    )
  }
}
