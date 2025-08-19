import { BlockchainNetwork, CryptoCurrency, SupportedCurrency, TargetCurrency } from '@prisma/client'
import { inject } from 'inversify'

import { ILogger, IQueueHandler, ISlackNotifier, QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IExchangeProviderFactory } from '../../interfaces/IExchangeProviderFactory'
import { IWalletHandlerFactory } from '../../interfaces/IWalletHandlerFactory'
import { PaymentSentMessage, PaymentSentMessageSchema } from '../../interfaces/queueSchema'
import { TYPES } from '../../types'

export class PaymentSentController {
  public constructor(
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.IWalletHandlerFactory) private walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ISlackNotifier) private slackNotifier: ISlackNotifier,
    @inject(TYPES.IDatabaseClientProvider) private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IExchangeProviderFactory) private exchangeProviderFactory: IExchangeProviderFactory,
  ) {

  }

  public registerConsumers() {
    try {
      this.logger.info(
        '[PaymentSent queue]: Registering consumer for queue:',
        QueueName.PAYMENT_SENT,
      )
      this.queueHandler.subscribeToQueue(
        QueueName.PAYMENT_SENT,
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

    await this.sendToExchangeAndUpdatePendingConversions({
      amount,
      blockchain,
      cryptoCurrency,
      targetCurrency,
    })

    this.logger.info(
      '[PaymentSent Queue]: Payment sent successfully',
    )
  }

  private sendToExchangeAndUpdatePendingConversions = async ({
    amount,
    blockchain,
    cryptoCurrency,
    targetCurrency,
  }: {
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }) => {
    const walletHandler = this.walletHandlerFactory.getWalletHandler(blockchain)
    const exchangeProvider = this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
    const { address, memo } = await exchangeProvider.getExchangeAddress({ blockchain, cryptoCurrency })

    const { success, transactionId } = await walletHandler.send({ address, amount, cryptoCurrency, memo })

    if (!success) {
      this.logger.error('[PaymentSent Queue]: Error sending payment to exchange:', transactionId)
      this.slackNotifier.sendMessage(
        `[PaymentSent Queue]: Error exchanging ${amount} ${cryptoCurrency} to ${targetCurrency}.`,
      )
      return
    }

    const clientDb = await this.dbClientProvider.getClient()

    if (cryptoCurrency === SupportedCurrency.USDC && targetCurrency === SupportedCurrency.COP) {
      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: cryptoCurrency,
          symbol: 'USDCUSDT',
          target: SupportedCurrency.USDT,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: cryptoCurrency, target: SupportedCurrency.USDT },
        },
      })

      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: SupportedCurrency.USDT,
          symbol: 'USDTCOP',
          target: targetCurrency,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: SupportedCurrency.USDT, target: targetCurrency },
        },
      })
    }
    else if (cryptoCurrency === SupportedCurrency.USDC && targetCurrency === SupportedCurrency.BRL) {
      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: cryptoCurrency,
          symbol: 'USDCBRL',
          target: targetCurrency,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: cryptoCurrency, target: targetCurrency },
        },
      })
    }
  }
}
