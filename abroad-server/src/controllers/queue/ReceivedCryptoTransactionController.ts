// src/controllers/queue/StellarReceivedCryptoTransactionController.ts
import { BlockchainNetwork, CryptoCurrency, Prisma, TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import z from 'zod'

import {
  ILogger,
  IQueueHandler,
  ISlackNotifier,
  IWalletHandlerFactory,
  QueueName,
} from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import { IWebhookNotifier, WebhookEvent } from '../../interfaces/IWebhookNotifier'
import { PaymentSentMessage } from '../../interfaces/queueSchema'
import { TYPES } from '../../types'

const TransactionQueueMessageSchema = z.object({
  addressFrom: z.string().min(1, 'Address from is required'),
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  onChainId: z.string(),
  transactionId: z.string().uuid(),
})

export type TransactionQueueMessage = z.infer<
  typeof TransactionQueueMessageSchema
>

type PrismaClientInstance = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

const transactionInclude = {
  partnerUser: { include: { partner: true } },
  quote: true,
} as const

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>

export class ReceivedCryptoTransactionController {
  private readonly logPrefix = '[ReceivedCryptoTransaction]'

  public constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.ISlackNotifier) private slackNotifier: ISlackNotifier,
    @inject(TYPES.IWalletHandlerFactory) private walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.IWebhookNotifier) private webhookNotifier: IWebhookNotifier,
  ) { }

  public registerConsumers() {
    try {
      this.logger.info(
        `${this.logPrefix}: Registering consumer for queue:`,
        QueueName.RECEIVED_CRYPTO_TRANSACTION,
      )
      this.queueHandler.subscribeToQueue(
        QueueName.RECEIVED_CRYPTO_TRANSACTION,
        this.onTransactionReceived.bind(this),
      )
    }
    catch (error) {
      this.logger.error(
        `${this.logPrefix}: Error in consumer registration:`,
        error,
      )
    }
  }

  private async getClientOrRefund(
    message: TransactionQueueMessage,
    logPrefix: string,
  ): Promise<PrismaClientInstance | undefined> {
    try {
      return await this.dbClientProvider.getClient()
    }
    catch (paymentError) {
      this.logger.error(
        `${logPrefix}: Payment processing error:`,
        paymentError,
      )
      await this.sendRefund(message)
      return undefined
    }
  }

  private async handlePaymentFailure(
    prismaClient: PrismaClientInstance,
    transactionRecord: TransactionWithRelations,
    message: TransactionQueueMessage,
    logPrefix: string,
    paymentError: unknown,
  ): Promise<void> {
    this.logger.error(
      `${logPrefix}: Payment processing error:`,
      paymentError,
    )
    const failedTransaction = await this.updateTransactionStatus(
      prismaClient,
      transactionRecord.id,
      TransactionStatus.PAYMENT_FAILED,
    )
    await this.notifyTransactionUpdate(failedTransaction, logPrefix, 'error')

    const refundResult = await this.sendRefund(message)
    await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult)
  }

  private async handleWrongAmount(
    prismaClient: PrismaClientInstance,
    transactionRecord: TransactionWithRelations,
    message: TransactionQueueMessage,
    logPrefix: string,
  ): Promise<void> {
    this.logger.warn(
      `${logPrefix}: Transaction amount does not match quote:`,
      message.amount,
      transactionRecord.quote.sourceAmount,
    )

    const updatedTransaction = await this.updateTransactionStatus(
      prismaClient,
      transactionRecord.id,
      TransactionStatus.WRONG_AMOUNT,
    )
    await this.notifyTransactionUpdate(updatedTransaction, logPrefix, 'wrong amount')

    const refundResult = await this.sendRefund(message)
    await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult)
  }

  private async markTransactionProcessing(
    prismaClient: PrismaClientInstance,
    message: TransactionQueueMessage,
    logPrefix: string,
  ): Promise<TransactionWithRelations | undefined> {
    try {
      const transactionRecord = await prismaClient.transaction.update({
        data: {
          onChainId: message.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        include: transactionInclude,
        where: {
          id: message.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })
      await this.notifyTransactionUpdate(transactionRecord, logPrefix, 'processing')
      return transactionRecord
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        this.logger.warn(
          `${logPrefix}: Transaction not found or already processed:`,
          message.transactionId,
        )
        return undefined
      }
      this.logger.error(
        `${logPrefix}: Error updating transaction:`,
        error,
      )
      return undefined
    }
  }

  private async notifyTransactionUpdate(
    transaction: TransactionWithRelations,
    logPrefix: string,
    context: string,
  ): Promise<void> {
    this.webhookNotifier.notifyWebhook(transaction.partnerUser.partner.webhookUrl, { data: transaction, event: WebhookEvent.TRANSACTION_CREATED })
    try {
      await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
        payload: JSON.stringify(transaction),
        type: 'transaction.updated',
        userId: transaction.partnerUser.userId,
      })
    }
    catch (error) {
      const warningContext = error instanceof Error ? error : new Error(String(error))
      this.logger.warn(`${logPrefix}: Failed to publish ws notification (${context})`, warningContext)
    }
  }

  /**
   * Processes a transaction message from the queue.
   */
  private async onTransactionReceived(
    msg: Record<string, boolean | number | string>,
  ): Promise<void> {
    const message = this.parseMessage(msg)
    if (!message) {
      return
    }
    const logPrefix = `${this.logPrefix}:${message.blockchain}`
    this.logger.info(
      `${logPrefix}: Received transaction from queue:`,
      message.onChainId,
    )

    const prismaClient = await this.getClientOrRefund(message, logPrefix)
    if (!prismaClient) {
      return
    }

    const transactionRecord = await this.markTransactionProcessing(
      prismaClient,
      message,
      logPrefix,
    )
    if (!transactionRecord) {
      return
    }

    const hasMismatchedAmount = message.amount < transactionRecord.quote.sourceAmount
    if (hasMismatchedAmount) {
      await this.handleWrongAmount(prismaClient, transactionRecord, message, logPrefix)
      return
    }

    await this.processPayment(prismaClient, transactionRecord, message, logPrefix)
  }

  private parseMessage(msg: Record<string, boolean | number | string>): TransactionQueueMessage | undefined {
    if (!msg || Object.keys(msg).length === 0) {
      this.logger.warn(
        `${this.logPrefix}: Received empty message. Skipping...`,
      )
      return undefined
    }

    const parsedMessage = TransactionQueueMessageSchema.safeParse(msg)
    if (!parsedMessage.success) {
      this.logger.error(`${this.logPrefix}: Invalid message format:`, parsedMessage.error)
      return undefined
    }

    return parsedMessage.data
  }

  private async persistExternalId(
    prismaClient: PrismaClientInstance,
    transactionId: string,
    externalId: string,
  ): Promise<void> {
    await prismaClient.transaction.update({
      data: {
        externalId,
      },
      where: { id: transactionId },
    })
  }

  private async processPayment(
    prismaClient: PrismaClientInstance,
    transactionRecord: TransactionWithRelations,
    message: TransactionQueueMessage,
    logPrefix: string,
  ): Promise<void> {
    const paymentService = this.paymentServiceFactory.getPaymentService(
      transactionRecord.quote.paymentMethod,
    )

    try {
      const paymentResponse = await paymentService.sendPayment({
        account: transactionRecord.accountNumber,
        bankCode: transactionRecord.bankCode,
        id: transactionRecord.id,
        qrCode: transactionRecord.qrCode,
        value: transactionRecord.quote.targetAmount,
      })

      if (paymentResponse.success && paymentResponse.transactionId) {
        await this.persistExternalId(prismaClient, transactionRecord.id, paymentResponse.transactionId)
      }

      if (paymentService.isAsync && paymentResponse.success) {
        this.logger.info(
          `${logPrefix}: Payment dispatched for async confirmation`,
          transactionRecord.id,
        )
        return
      }

      const newStatus = paymentResponse.success
        ? TransactionStatus.PAYMENT_COMPLETED
        : TransactionStatus.PAYMENT_FAILED

      const updatedTransaction = await this.updateTransactionStatus(
        prismaClient,
        transactionRecord.id,
        newStatus,
      )
      await this.notifyTransactionUpdate(updatedTransaction, logPrefix, 'final')

      if (paymentResponse.success) {
        this.slackNotifier.sendMessage(
          `Payment completed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
        )

        await this.publishPaymentSentMessage(transactionRecord)
      }
      else {
        this.slackNotifier.sendMessage(
          `Payment failed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
        )
        const refundResult = await this.sendRefund(message)
        await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult)
      }
    }
    catch (paymentError) {
      await this.handlePaymentFailure(prismaClient, transactionRecord, message, logPrefix, paymentError)
    }
  }

  private async publishPaymentSentMessage(transactionRecord: TransactionWithRelations): Promise<void> {
    try {
      await this.queueHandler.postMessage(QueueName.PAYMENT_SENT, {
        amount: transactionRecord.quote.sourceAmount,
        blockchain: transactionRecord.quote.network,
        cryptoCurrency: transactionRecord.quote.cryptoCurrency,
        paymentMethod: transactionRecord.quote.paymentMethod,
        targetCurrency: transactionRecord.quote.targetCurrency,
      } satisfies PaymentSentMessage)
    }
    catch (error) {
      const warningContext = error instanceof Error ? error : new Error(String(error))
      this.logger.warn(`${this.logPrefix}: Failed to publish payment sent notification`, warningContext)
    }
  }

  private async recordRefundOnChainId(
    prismaClient: PrismaClientInstance,
    transactionId: string,
    refundResult: { success: boolean, transactionId?: string },
  ): Promise<void> {
    if (!refundResult.success || !refundResult.transactionId) {
      this.logger.warn(
        '[ReceivedCryptoTransaction] Refund transaction submission failed; no on-chain hash recorded',
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
        '[ReceivedCryptoTransaction] Failed to persist refund transaction hash',
        error,
      )
    }
  }

  private async sendRefund(message: TransactionQueueMessage): Promise<{ success: boolean, transactionId?: string }> {
    const walletHandler = this.walletHandlerFactory.getWalletHandler(message.blockchain)
    return walletHandler.send({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
  }

  private async updateTransactionStatus(
    prismaClient: PrismaClientInstance,
    transactionId: string,
    status: TransactionStatus,
  ): Promise<TransactionWithRelations> {
    return prismaClient.transaction.update({
      data: { status },
      include: transactionInclude,
      where: { id: transactionId },
    })
  }
}
