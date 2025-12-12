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
import { createScopedLogger } from '../../shared/logging'
import { getCorrelationId } from '../../shared/requestContext'
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
    const normalized = (status || '').toLowerCase()
    // Use substring matching to handle statuses that contain extra words
    if ([
      'canceled',
      'cancelled',
      'error',
      'failed',
    ].some(word => normalized.includes(word))) return TransactionStatus.PAYMENT_FAILED
    if ([
      'processed',
      'settled',
      'success',
    ].some(word => normalized.includes(word))) return TransactionStatus.PAYMENT_COMPLETED

    if ([
      'pending',
      'processing',
      'queued',
    ].some(word => normalized.includes(word))) return TransactionStatus.PROCESSING_PAYMENT
    return TransactionStatus.PROCESSING_PAYMENT
  }

  private async onPaymentStatusUpdated(msg: unknown): Promise<void> {
    const logger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'PaymentStatusUpdated queue',
    })

    const parsed = PaymentStatusUpdatedMessageSchema.safeParse(msg)
    if (!parsed.success) {
      logger.error('[PaymentStatusUpdated queue]: Invalid message format:', parsed.error)
      return
    }
    const message: PaymentStatusUpdatedMessage = parsed.data

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
      // Notify partner webhook that the transaction was updated
      await this.webhookNotifier.notifyWebhook(
        transactionRecord.partnerUser.partner.webhookUrl,
        { data: transactionRecord, event: WebhookEvent.TRANSACTION_UPDATED },
      )

      // Notify user via websocket bridge with full payload
      try {
        await this.queueHandler.postMessage(
          QueueName.USER_NOTIFICATION,
          {
            payload: JSON.stringify(transactionRecord),
            type: 'transaction.updated',
            userId: transactionRecord.partnerUser.userId,
          },
        )
      }
      catch (e) {
        logger.warn('[PaymentStatusUpdated queue]: Failed to publish websocket notification', e as Error)
      }

      logger.info(
        `[Stellar transaction]: Payment ${newStatus === TransactionStatus.PAYMENT_COMPLETED ? 'completed' : 'failed'} for transaction:`,
        transactionRecord.id,
      )

      if (newStatus === TransactionStatus.PAYMENT_COMPLETED) {
        await this.slackNotifier.sendMessage(
          `Payment completed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
        )

        await this.queueHandler.postMessage(QueueName.PAYMENT_SENT, {
          amount: transactionRecord.quote.sourceAmount,
          blockchain: transactionRecord.quote.network,
          cryptoCurrency: transactionRecord.quote.cryptoCurrency,
          paymentMethod: transactionRecord.quote.paymentMethod,
          targetCurrency: transactionRecord.quote.targetCurrency,
        } satisfies PaymentSentMessage)
      }
      else {
        await this.slackNotifier.sendMessage(
          `Payment failed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
        )
        const walletHandler = this.walletHandlerFactory.getWalletHandler(
          transactionRecord.quote.network,
        )
        if (!transactionRecord.onChainId) {
          return
        }
        const address = await walletHandler.getAddressFromTransaction({ onChainId: transactionRecord.onChainId })
        const refundResult = await walletHandler.send({
          address: address,
          amount: transactionRecord.quote.sourceAmount,
          cryptoCurrency: transactionRecord.quote.cryptoCurrency,
        })
        await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult)
      }
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      this.slackNotifier.sendMessage(
        `[PaymentStatusUpdated queue]: Error updating transaction: ${errorMessage}`,
      )
      logger.error('[PaymentStatusUpdated queue]: Error updating transaction:', err)
    }
  }

  private async recordRefundOnChainId(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transactionId: string,
    refundResult: { success: boolean, transactionId?: string },
  ): Promise<void> {
    if (!refundResult.success || !refundResult.transactionId) {
      this.logger.warn(
        '[PaymentStatusUpdated queue]: Refund transaction submission failed; no on-chain hash recorded',
        { transactionId },
      )
      return
    }

    try {
      await prismaClient.transaction.updateMany({
        data: { refundOnChainId: refundResult.transactionId },
        where: { id: transactionId, refundOnChainId: null },
      })
    }
    catch (error) {
      this.logger.error(
        '[PaymentStatusUpdated queue]: Failed to persist refund transaction hash',
        error,
      )
    }
  }
}
