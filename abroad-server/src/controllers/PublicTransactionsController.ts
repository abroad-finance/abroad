// src/controllers/PublicTransactionsController.ts
import { Partner, PartnerUser, Quote, Transaction, TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Controller,
  Post,
  Route,
  SuccessResponse,
} from 'tsoa'

import { ILogger, IQueueHandler, QueueName } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IWebhookNotifier, WebhookEvent } from '../interfaces/IWebhookNotifier'
import { TYPES } from '../types'

interface CheckExpiredTransactionsResponse {
  awaiting: number
  expired: number
  updated: number
  updatedTransactionIds: string[]
}

type TransactionWithRelations = Transaction & {
  partnerUser: PartnerUser & { partner: Partner }
  quote: Quote
}

@Route('transactions')
export class PublicTransactionsController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IWebhookNotifier) private webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) {
    super()
  }

  /**
   * Checks all awaiting-payment transactions and marks expired ones as failed.
   * Returns how many were inspected and updated.
   */
  @Post('check-expired')
  @SuccessResponse('200', 'Expired transactions processed')
  public async checkExpiredTransactions(): Promise<CheckExpiredTransactionsResponse> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const now = new Date()

    const totalAwaiting = await prismaClient.transaction.count({
      where: { status: TransactionStatus.AWAITING_PAYMENT },
    })

    const expiredTransactions = await prismaClient.transaction.findMany({
      include: {
        partnerUser: { include: { partner: true } },
        quote: true,
      },
      where: {
        quote: { expirationDate: { lt: now } },
        status: TransactionStatus.AWAITING_PAYMENT,
      },
    })

    if (expiredTransactions.length === 0) {
      this.logger.info('[PublicTransactionsController] No expired transactions found')
      return {
        awaiting: totalAwaiting,
        expired: 0,
        updated: 0,
        updatedTransactionIds: [],
      }
    }

    const updatedTransactions: TransactionWithRelations[] = []

    for (const transaction of expiredTransactions) {
      try {
        const result = await prismaClient.transaction.updateMany({
          data: { status: TransactionStatus.PAYMENT_EXPIRED },
          where: {
            id: transaction.id,
            status: TransactionStatus.AWAITING_PAYMENT,
          },
        })

        if (result.count === 0) {
          continue
        }

        updatedTransactions.push({
          ...transaction,
          status: TransactionStatus.PAYMENT_EXPIRED,
        })
      }
      catch (error) {
        this.logger.warn(
          '[PublicTransactionsController] Failed to mark transaction as expired',
          { error, transactionId: transaction.id },
        )
      }
    }

    await this.notifyUpdates(updatedTransactions)

    this.logger.info(
      '[PublicTransactionsController] Expired transactions processed',
      {
        processed: expiredTransactions.length,
        updated: updatedTransactions.length,
      },
    )

    return {
      awaiting: totalAwaiting,
      expired: expiredTransactions.length,
      updated: updatedTransactions.length,
      updatedTransactionIds: updatedTransactions.map((tx) => tx.id),
    }
  }

  private async notifyUpdates(transactions: TransactionWithRelations[]): Promise<void> {
    if (transactions.length === 0) {
      return
    }

    for (const transaction of transactions) {
      try {
        await this.webhookNotifier.notifyWebhook(
          transaction.partnerUser.partner.webhookUrl,
          { data: transaction, event: WebhookEvent.TRANSACTION_UPDATED },
        )
      }
      catch (error) {
        this.logger.warn(
          '[PublicTransactionsController] Failed to notify webhook for expired transaction',
          { error, transactionId: transaction.id },
        )
      }

      try {
        await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
          payload: JSON.stringify(transaction),
          type: 'transaction.updated',
          userId: transaction.partnerUser.userId,
        })
      }
      catch (error) {
        this.logger.warn(
          '[PublicTransactionsController] Failed to enqueue ws notification for expired transaction',
          { error, transactionId: transaction.id },
        )
      }
    }
  }
}
