import {
  Partner,
  PartnerUser,
  PrismaClient,
  Quote,
  Transaction,
  TransactionStatus,
} from '@prisma/client'

import { ILogger } from '../../../core/logging/types'
import { IQueueHandler, QueueName, UserNotificationMessage } from '../../../platform/messaging/queues'
import { IWebhookNotifier, WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export type ExpiredTransactionsSummary = {
  awaiting: number
  expired: number
  updated: number
  updatedTransactionIds: string[]
}

type TransactionWithRelations = Transaction & {
  partnerUser: PartnerUser & { partner: Partner }
  quote: Quote
}

export class ExpiredTransactionService {
  constructor(
    private readonly prismaProvider: IDatabaseClientProvider,
    private readonly webhookNotifier: IWebhookNotifier,
    private readonly queueHandler: IQueueHandler,
    private readonly logger: ILogger,
  ) {}

  public async process(now: Date = new Date()): Promise<ExpiredTransactionsSummary> {
    const prismaClient = await this.prismaProvider.getClient()
    const [totalAwaiting, expiredTransactions] = await Promise.all([
      prismaClient.transaction.count({ where: { status: TransactionStatus.AWAITING_PAYMENT } }),
      this.findExpiredTransactions(prismaClient, now),
    ])

    if (expiredTransactions.length === 0) {
      this.logger.info('[PublicTransactionsController] No expired transactions found')
      return {
        awaiting: totalAwaiting,
        expired: 0,
        updated: 0,
        updatedTransactionIds: [],
      }
    }

    const updatedTransactions = await this.expireTransactions(prismaClient, expiredTransactions)
    await Promise.all(updatedTransactions.map(transaction => this.notifyUpdates(transaction)))

    this.logger.info(
      '[PublicTransactionsController] Expired transactions processed',
      { processed: expiredTransactions.length, updated: updatedTransactions.length },
    )

    return {
      awaiting: totalAwaiting,
      expired: expiredTransactions.length,
      updated: updatedTransactions.length,
      updatedTransactionIds: updatedTransactions.map(tx => tx.id),
    }
  }

  private async expireSingleTransaction(
    prismaClient: PrismaClient,
    transaction: TransactionWithRelations,
  ): Promise<null | TransactionWithRelations> {
    try {
      const result = await prismaClient.transaction.updateMany({
        data: { status: TransactionStatus.PAYMENT_EXPIRED },
        where: {
          id: transaction.id,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })

      if (result.count === 0) {
        return null
      }

      return {
        ...transaction,
        status: TransactionStatus.PAYMENT_EXPIRED,
      }
    }
    catch (error) {
      this.logger.warn(
        '[PublicTransactionsController] Failed to mark transaction as expired',
        { error, transactionId: transaction.id },
      )
      return null
    }
  }

  private async expireTransactions(
    prismaClient: PrismaClient,
    expiredTransactions: TransactionWithRelations[],
  ): Promise<TransactionWithRelations[]> {
    const updates = await Promise.all(
      expiredTransactions.map(transaction => this.expireSingleTransaction(prismaClient, transaction)),
    )

    return updates.filter((transaction): transaction is TransactionWithRelations => Boolean(transaction))
  }

  private async findExpiredTransactions(prismaClient: PrismaClient, now: Date): Promise<TransactionWithRelations[]> {
    return prismaClient.transaction.findMany({
      include: {
        partnerUser: { include: { partner: true } },
        quote: true,
      },
      where: {
        quote: { expirationDate: { lt: now } },
        status: TransactionStatus.AWAITING_PAYMENT,
      },
    })
  }

  private async notifyUpdates(transaction: TransactionWithRelations): Promise<void> {
    const webhookTarget = transaction.partnerUser.partner.webhookUrl
    const queueMessage: UserNotificationMessage = { payload: JSON.stringify(transaction), type: 'transaction.updated', userId: transaction.partnerUser.userId }

    const [webhookResult, queueResult] = await Promise.allSettled([
      this.webhookNotifier.notifyWebhook(webhookTarget, { data: transaction, event: WebhookEvent.TRANSACTION_UPDATED }),
      this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, queueMessage),
    ])

    if (webhookResult.status === 'rejected') {
      this.logger.warn(
        '[PublicTransactionsController] Failed to notify webhook for expired transaction',
        { error: webhookResult.reason, transactionId: transaction.id },
      )
    }

    if (queueResult.status === 'rejected') {
      this.logger.warn(
        '[PublicTransactionsController] Failed to enqueue ws notification for expired transaction',
        { error: queueResult.reason, transactionId: transaction.id },
      )
    }
  }
}
