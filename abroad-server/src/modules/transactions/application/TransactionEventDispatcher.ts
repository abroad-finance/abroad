import { Prisma, PrismaClient, TransactionStatus } from '@prisma/client'

import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { QueueName } from '../../../platform/messaging/queues'
import { PaymentSentMessage } from '../../../platform/messaging/queueSchema'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { isSupportedPaymentMethod } from '../../payments/application/supportedPaymentMethods'
import { TransactionWithRelations } from './transactionNotificationTypes'
import { toWebhookTransactionPayload } from './transactionPayload'
import { buildTransactionSlackMessage } from './transactionSlackFormatter'

type PrismaClientLike = Prisma.TransactionClient | PrismaClient

export class TransactionEventDispatcher {
  private readonly logger: ScopedLogger

  public constructor(
    private readonly outboxDispatcher: OutboxDispatcher,
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransactionEvents' })
  }

  public async notifyPartnerAndUser(
    transaction: TransactionWithRelations,
    event: WebhookEvent,
    type: 'transaction.created' | 'transaction.updated',
    context: string,
    options: { deliverNow?: boolean, prismaClient?: PrismaClientLike } = {},
  ): Promise<void> {
    const payload = toWebhookTransactionPayload(transaction)
    try {
      await this.outboxDispatcher.enqueueWebhook(
        transaction.partnerUser.partner.webhookUrl,
        { data: payload, event },
        context,
        { client: options.prismaClient, deliverNow: options.deliverNow },
      )
    }
    catch (error) {
      this.logger.warn(`Failed to notify webhook (${context})`, error)
    }

    try {
      await this.outboxDispatcher.enqueueQueue(QueueName.USER_NOTIFICATION, {
        payload: JSON.stringify(payload),
        type,
        userId: transaction.partnerUser.userId,
      }, `user-notification:${context}`, { client: options.prismaClient, deliverNow: options.deliverNow })
    }
    catch (error) {
      this.logger.warn(`Failed to publish websocket notification (${context})`, error)
    }
  }

  public async notifySlack(
    transaction: TransactionWithRelations,
    status: TransactionStatus,
    options: {
      deliverNow?: boolean
      heading?: string
      notes?: Record<string, boolean | null | number | string | undefined>
      prismaClient?: PrismaClientLike
      trigger: string
    },
  ): Promise<void> {
    const heading = options.heading ?? (status === TransactionStatus.PAYMENT_COMPLETED ? 'Payment completed' : 'Payment failed')
    const message = buildTransactionSlackMessage(transaction, {
      heading,
      notes: options.notes,
      status,
      trigger: options.trigger,
    })

    await this.outboxDispatcher.enqueueSlack(message, 'slack', {
      client: options.prismaClient,
      deliverNow: options.deliverNow,
    })
  }

  public async publishPaymentSent(
    transaction: TransactionWithRelations,
  ): Promise<void> {
    const paymentMethod = transaction.quote.paymentMethod
    if (!isSupportedPaymentMethod(paymentMethod)) {
      this.logger.warn('Skipping payment sent notification for unsupported payment method', { paymentMethod })
      return
    }
    const message: PaymentSentMessage = {
      amount: transaction.quote.sourceAmount,
      blockchain: transaction.quote.network,
      cryptoCurrency: transaction.quote.cryptoCurrency,
      paymentMethod,
      targetCurrency: transaction.quote.targetCurrency,
      transactionId: transaction.id,
    }

    try {
      await this.outboxDispatcher.enqueueQueue(QueueName.PAYMENT_SENT, message, 'payment-sent', {
        deliverNow: true,
      })
    }
    catch (error) {
      this.logger.warn('Failed to publish payment sent notification', error)
    }
  }
}
