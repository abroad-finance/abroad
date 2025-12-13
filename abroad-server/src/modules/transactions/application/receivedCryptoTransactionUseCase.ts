import { Prisma, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../platform/messaging/queues'
import { PaymentSentMessage, ReceivedCryptoTransactionMessage, ReceivedCryptoTransactionMessageSchema } from '../../../platform/messaging/queueSchema'
import { ISlackNotifier } from '../../../platform/notifications/ISlackNotifier'
import { IWebhookNotifier, WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'

type PrismaClientInstance = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>
type TransactionClient = Prisma.TransactionClient | PrismaClientInstance

const transactionInclude = {
  partnerUser: { include: { partner: true } },
  quote: true,
} as const

export interface IReceivedCryptoTransactionUseCase {
  process(rawMessage: unknown): Promise<void>
}

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>

class RefundService {
  constructor(private readonly walletHandlerFactory: IWalletHandlerFactory) {}

  public async refundToSender(
    message: ReceivedCryptoTransactionMessage,
  ): Promise<{ success: boolean, transactionId?: string }> {
    const walletHandler = this.walletHandlerFactory.getWalletHandler(message.blockchain)
    return walletHandler.send({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
  }
}

class TransactionNotifier {
  constructor(
    private readonly webhookNotifier: IWebhookNotifier,
    private readonly queueHandler: IQueueHandler,
    private readonly logger: ScopedLogger,
  ) {}

  public async notify(
    transaction: TransactionWithRelations,
    event: WebhookEvent,
    context: string,
  ): Promise<void> {
    try {
      await this.webhookNotifier.notifyWebhook(
        transaction.partnerUser.partner.webhookUrl,
        { data: transaction, event },
      )
    }
    catch (error) {
      this.logger.warn(`Failed to notify partner webhook (${context})`, error)
    }

    try {
      await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
        payload: JSON.stringify(transaction),
        type: 'transaction.updated',
        userId: transaction.partnerUser.userId,
      })
    }
    catch (error) {
      const warningContext = error instanceof Error ? error : new Error(String(error))
      this.logger.warn(`Failed to publish ws notification (${context})`, warningContext)
    }
  }
}

class TransactionRepository {
  constructor(private readonly include = transactionInclude) {}

  public async markProcessing(
    prismaClient: TransactionClient,
    message: ReceivedCryptoTransactionMessage,
    logger: ScopedLogger,
  ): Promise<TransactionWithRelations | undefined> {
    try {
      return await prismaClient.transaction.update({
        data: {
          onChainId: message.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        include: this.include,
        where: {
          id: message.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        logger.warn('Transaction not found or already processed', { transactionId: message.transactionId })
        return undefined
      }
      logger.error('Error updating transaction', error)
      return undefined
    }
  }

  public async persistExternalId(
    prismaClient: TransactionClient,
    transactionId: string,
    externalId: string,
  ): Promise<void> {
    await prismaClient.transaction.update({
      data: { externalId },
      where: { id: transactionId },
    })
  }

  public async recordRefundOnChainId(
    prismaClient: TransactionClient,
    transactionId: string,
    refundTransactionId: string,
  ): Promise<void> {
    await prismaClient.transaction.updateMany({
      data: { refundOnChainId: refundTransactionId },
      where: { id: transactionId, refundOnChainId: null },
    })
  }

  public async updateStatus(
    prismaClient: TransactionClient,
    transactionId: string,
    status: TransactionStatus,
  ): Promise<TransactionWithRelations> {
    return prismaClient.transaction.update({
      data: { status },
      include: this.include,
      where: { id: transactionId },
    })
  }
}

@injectable()
export class ReceivedCryptoTransactionUseCase implements IReceivedCryptoTransactionUseCase {
  private readonly refundService: RefundService
  private readonly repository = new TransactionRepository()

  public constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.ISlackNotifier) private readonly slackNotifier: ISlackNotifier,
    @inject(TYPES.IWalletHandlerFactory) walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.IWebhookNotifier) private readonly webhookNotifier: IWebhookNotifier,
  ) {
    this.refundService = new RefundService(walletHandlerFactory)
  }

  public async process(rawMessage: unknown): Promise<void> {
    const baseLogger = this.createLogger()
    const parsedMessage = this.parseMessage(rawMessage, baseLogger)
    if (!parsedMessage) {
      return
    }

    const logger = baseLogger.child({
      staticPayload: {
        blockchain: parsedMessage.blockchain,
        transactionId: parsedMessage.transactionId,
      },
    })

    const prismaClient = await this.getClientOrRefund(parsedMessage, logger)
    if (!prismaClient) {
      return
    }

    const notifier = new TransactionNotifier(this.webhookNotifier, this.queueHandler, logger)
    const transactionRecord = await this.repository.markProcessing(prismaClient, parsedMessage, logger)
    if (!transactionRecord) {
      return
    }
    await notifier.notify(transactionRecord, WebhookEvent.TRANSACTION_CREATED, 'processing')

    const hasMismatchedAmount = parsedMessage.amount < transactionRecord.quote.sourceAmount
    if (hasMismatchedAmount) {
      await this.handleWrongAmount(prismaClient, transactionRecord, parsedMessage, notifier, logger)
      return
    }

    await this.processPayment(prismaClient, transactionRecord, parsedMessage, notifier, logger)
  }

  private createLogger(staticPayload?: Record<string, unknown>): ScopedLogger {
    const correlationId = getCorrelationId()
    return createScopedLogger(this.logger, { correlationId, scope: 'ReceivedCryptoTransaction', staticPayload })
  }

  private async getClientOrRefund(
    message: ReceivedCryptoTransactionMessage,
    logger: ScopedLogger,
  ): Promise<PrismaClientInstance | undefined> {
    try {
      return await this.dbClientProvider.getClient()
    }
    catch (error) {
      logger.error('Payment processing error while acquiring database client', error)
      await this.refundService.refundToSender(message)
      return undefined
    }
  }

  private async handlePaymentFailure(
    prismaClient: TransactionClient,
    transactionRecord: TransactionWithRelations,
    message: ReceivedCryptoTransactionMessage,
    notifier: TransactionNotifier,
    logger: ScopedLogger,
    paymentError: unknown,
  ): Promise<void> {
    logger.error('Payment processing error', paymentError)
    const failedTransaction = await this.repository.updateStatus(
      prismaClient,
      transactionRecord.id,
      TransactionStatus.PAYMENT_FAILED,
    )
    await notifier.notify(failedTransaction, WebhookEvent.TRANSACTION_CREATED, 'error')

    const refundResult = await this.refundService.refundToSender(message)
    await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult, logger)
  }

  private async handleWrongAmount(
    prismaClient: TransactionClient,
    transactionRecord: TransactionWithRelations,
    message: ReceivedCryptoTransactionMessage,
    notifier: TransactionNotifier,
    logger: ScopedLogger,
  ): Promise<void> {
    logger.warn(
      'Transaction amount does not match quote',
      {
        expectedAmount: transactionRecord.quote.sourceAmount,
        receivedAmount: message.amount,
      },
    )

    const updatedTransaction = await this.repository.updateStatus(
      prismaClient,
      transactionRecord.id,
      TransactionStatus.WRONG_AMOUNT,
    )
    await notifier.notify(updatedTransaction, WebhookEvent.TRANSACTION_CREATED, 'wrong_amount')

    const refundResult = await this.refundService.refundToSender(message)
    await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult, logger)
  }

  private async notifySlack(message: string, logger: ScopedLogger): Promise<void> {
    try {
      await this.slackNotifier.sendMessage(message)
    }
    catch (error) {
      logger.warn('Failed to send slack notification', error)
    }
  }

  private parseMessage(
    msg: unknown,
    logger: ScopedLogger,
  ): ReceivedCryptoTransactionMessage | undefined {
    const parsedMessage = ReceivedCryptoTransactionMessageSchema.safeParse(msg)
    if (!parsedMessage.success) {
      logger.error('Invalid message format', parsedMessage.error)
      return undefined
    }

    return parsedMessage.data
  }

  private async processPayment(
    prismaClient: TransactionClient,
    transactionRecord: TransactionWithRelations,
    message: ReceivedCryptoTransactionMessage,
    notifier: TransactionNotifier,
    logger: ScopedLogger,
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
        await this.repository.persistExternalId(prismaClient, transactionRecord.id, paymentResponse.transactionId)
      }

      if (paymentService.isAsync && paymentResponse.success) {
        logger.info('Payment dispatched for async confirmation')
        return
      }

      const newStatus = paymentResponse.success
        ? TransactionStatus.PAYMENT_COMPLETED
        : TransactionStatus.PAYMENT_FAILED

      const updatedTransaction = await this.repository.updateStatus(
        prismaClient,
        transactionRecord.id,
        newStatus,
      )
      await notifier.notify(updatedTransaction, WebhookEvent.TRANSACTION_CREATED, 'final')

      if (paymentResponse.success) {
        await this.notifySlack(
          `Payment completed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
          logger,
        )
        await this.publishPaymentSentMessage(transactionRecord, logger)
      }
      else {
        await this.notifySlack(
          `Payment failed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}, Partner: ${transactionRecord.partnerUser.partner.name}`,
          logger,
        )
        const refundResult = await this.refundService.refundToSender(message)
        await this.recordRefundOnChainId(prismaClient, transactionRecord.id, refundResult, logger)
      }
    }
    catch (paymentError) {
      await this.handlePaymentFailure(prismaClient, transactionRecord, message, notifier, logger, paymentError)
    }
  }

  private async publishPaymentSentMessage(
    transactionRecord: TransactionWithRelations,
    logger: ScopedLogger,
  ): Promise<void> {
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
      logger.warn('Failed to publish payment sent notification', warningContext)
    }
  }

  private async recordRefundOnChainId(
    prismaClient: TransactionClient,
    transactionId: string,
    refundResult: { success: boolean, transactionId?: string },
    logger: ScopedLogger,
  ): Promise<void> {
    if (!refundResult.success || !refundResult.transactionId) {
      logger.warn(
        'Refund transaction submission failed; no on-chain hash recorded',
        { transactionId },
      )
      return
    }

    try {
      await this.repository.recordRefundOnChainId(prismaClient, transactionId, refundResult.transactionId)
    }
    catch (error) {
      logger.error('Failed to persist refund transaction hash', error)
    }
  }
}
