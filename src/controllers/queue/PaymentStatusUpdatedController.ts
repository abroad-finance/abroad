import { TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'

import {
  ILogger,
  IQueueHandler,
  ISlackNotifier,
  IWalletHandlerFactory,
  QueueName,
} from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IWebhookNotifier, WebhookEvent } from '../../interfaces/IWebhookNotifier'
import { PaymentSentMessage, PaymentStatusUpdatedMessage, PaymentStatusUpdatedMessageSchema } from '../../interfaces/queueSchema'
import { TYPES } from '../../types'

/**
 * Consumes payment status update messages coming from providers like Transfero
 * and updates the associated Transaction accordingly.
 */
export class PaymentStatusUpdatedController {
  public constructor(
        @inject(TYPES.ILogger) private logger: ILogger,
        @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
        @inject(TYPES.IDatabaseClientProvider) private dbClientProvider: IDatabaseClientProvider,
        @inject(TYPES.IWebhookNotifier) private webhookNotifier: IWebhookNotifier,
        @inject(TYPES.ISlackNotifier) private slackNotifier: ISlackNotifier,
        @inject(TYPES.IWalletHandlerFactory) private walletHandlerFactory: IWalletHandlerFactory,

  ) { }

  public registerConsumers() {
    try {
      this.logger.info('[PaymentStatusUpdated queue]: Registering consumer for queue:', QueueName.PAYMENT_STATUS_UPDATED)
      this.queueHandler.subscribeToQueue(
        QueueName.PAYMENT_STATUS_UPDATED,
        this.onPaymentStatusUpdated.bind(this),
      )
    }
    catch (error) {
      this.logger.error('[PaymentStatusUpdated queue]: Error in consumer registration:', error)
    }
  }

  private mapProviderStatus(status: string): TransactionStatus {
    const normalized = status.toLowerCase()
    if ([
      'completed',
      'processed',
      'settled',
      'success',
    ].includes(normalized)) return TransactionStatus.PAYMENT_COMPLETED
    if ([
      'canceled',
      'cancelled',
      'error',
      'failed',
    ].includes(normalized)) return TransactionStatus.PAYMENT_FAILED
    if ([
      'pending',
      'processing',
      'queued',
    ].includes(normalized)) return TransactionStatus.PROCESSING_PAYMENT
    return TransactionStatus.PROCESSING_PAYMENT
  }

  private async onPaymentStatusUpdated(msg: Record<string, boolean | number | string>): Promise<void> {
    if (!msg || Object.keys(msg).length === 0) {
      this.logger.warn('[PaymentStatusUpdated queue]: Received empty message. Skipping...')
      return
    }

    let message: PaymentStatusUpdatedMessage
    try {
      message = PaymentStatusUpdatedMessageSchema.parse(msg)
    }
    catch (error) {
      this.logger.error('[PaymentStatusUpdated queue]: Invalid message format:', error)
      return
    }

    const prismaClient = await this.dbClientProvider.getClient()

    // Correlate using ExternalId as our Transaction.id (assumption) and
    // fall back to provider PaymentId stored as onChainId when available.
    try {
      // Map provider status to internal status
      const newStatus = this.mapProviderStatus(message.status)

      if (newStatus === TransactionStatus.PROCESSING_PAYMENT) {
        return
      }

      const transactionRecord = await prismaClient.transaction.update({
        data: { status: newStatus },
        include: {
          partnerUser: {
            include: {
              partner: true,
            },
          },
          quote: true,
        },
        where: { externalId: message.externalId },
      })
      this.webhookNotifier.notifyWebhook(transactionRecord.partnerUser.partner.webhookUrl, { data: transactionRecord, event: WebhookEvent.TRANSACTION_CREATED })

      this.logger.info(
        `[Stellar transaction]: Payment ${newStatus === TransactionStatus.PAYMENT_COMPLETED ? 'completed' : 'failed'} for transaction:`,
        transactionRecord.id,
      )

      if (newStatus === TransactionStatus.PAYMENT_COMPLETED) {
        this.slackNotifier.sendMessage(
          `Payment completed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
        )

        this.queueHandler.postMessage(QueueName.PAYMENT_SENT, {
          amount: transactionRecord.quote.sourceAmount,
          blockchain: transactionRecord.quote.network,
          cryptoCurrency: transactionRecord.quote.cryptoCurrency,
          paymentMethod: transactionRecord.quote.paymentMethod,
          targetCurrency: transactionRecord.quote.targetCurrency,
        } satisfies PaymentSentMessage)
      }
      else {
        this.slackNotifier.sendMessage(
          `Payment failed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
        )
        const walletHandler = this.walletHandlerFactory.getWalletHandler(
          transactionRecord.quote.network,
        )
        if (!transactionRecord.onChainId) {
          return
        }
        const address = await walletHandler.getAddressFromTransaction({ onChainId: transactionRecord.onChainId })
        await walletHandler.send({
          address: address,
          amount: transactionRecord.quote.sourceAmount,
          cryptoCurrency: transactionRecord.quote.cryptoCurrency,
        })
      }
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.slackNotifier.sendMessage(
        `[PaymentStatusUpdated queue]: Error updating transaction: ${errorMessage}`,
      )
      this.logger.error('[PaymentStatusUpdated queue]: Error updating transaction:', err)
    }
  }
}
