// src/controllers/queue/StellarTransactionsController.ts
import { BlockchainNetwork, CryptoCurrency, Prisma, TransactionStatus } from '@prisma/client'
import { inject } from 'inversify'
import z from 'zod'

import { ILogger, IQueueHandler, ISlackNotifier, QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import { TYPES } from '../../types'
// Import the logger interface (adjust the path as necessary)

// Schema definition for validating the queue message
const TransactionQueueMessageSchema = z.object({
  amount: z.number().positive(),
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  onChainId: z.string(),
  transactionId: z.string().uuid(),
})

export type TransactionQueueMessage = z.infer<
  typeof TransactionQueueMessageSchema
>

export class StellarTransactionsController {
  public constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.ISlackNotifier) private slackNotifier: ISlackNotifier,
  ) {}

  public registerConsumers() {
    try {
      this.logger.info(
        '[Stellar transaction]: Registering consumer for queue:',
        QueueName.STELLAR_TRANSACTIONS,
      )
      this.queueHandler.subscribeToQueue(
        QueueName.STELLAR_TRANSACTIONS,
        this.onTransactionReceived.bind(this),
      )
    }
    catch (error) {
      this.logger.error(
        '[Stellar transaction]: Error in consumer registration:',
        error,
      )
    }
  }

  /**
   * Processes a transaction message from the queue.
   */
  private async onTransactionReceived(
    msg: Record<string, boolean | number | string>,
  ): Promise<void> {
    if (!msg || Object.keys(msg).length === 0) {
      this.logger.warn(
        '[Stellar transaction]: Received empty message. Skipping...',
      )
      return
    }

    // Validate and parse the message early
    let message: TransactionQueueMessage
    try {
      message = TransactionQueueMessageSchema.parse(msg)
    }
    catch (error) {
      this.logger.error('[Stellar transaction]: Invalid message format:', error)
      return
    }
    this.logger.info(
      '[Stellar transaction]: Received transaction from queue:',
      message.onChainId,
    )

    const prismaClient = await this.dbClientProvider.getClient()

    let transactionRecord: Prisma.TransactionGetPayload<{
      include: { quote: true }
    }>
    try {
      // Execute DB operations in a transaction block
      transactionRecord = await prismaClient.transaction.update({
        data: {
          onChainId: message.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        include: { quote: true },
        where: {
          id: message.transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          this.logger.warn(
            '[Stellar transaction]: Transaction not found or already processed:',
            message.transactionId,
          )
          return
        }
      }
      this.logger.error(
        '[Stellar transaction]: Error updating transaction:',
        error,
      )
      return
    }

    // Validate that the amount in the message matches the expected quote
    if (message.amount < transactionRecord.quote.sourceAmount) {
      this.logger.warn(
        '[Stellar transaction]: Transaction amount does not match quote:',
        message.amount,
        transactionRecord.quote.sourceAmount,
      )
      await prismaClient.transaction.update({
        data: { status: TransactionStatus.WRONG_AMOUNT },
        where: { id: transactionRecord.id },
      })
      return
    }

    const paymentService = this.paymentServiceFactory.getPaymentService(
      transactionRecord.quote.paymentMethod,
    )

    // Process the payment and update the transaction accordingly
    try {
      const paymentResponse = await paymentService.sendPayment({
        account: transactionRecord.accountNumber,
        bankCode: transactionRecord.bankCode,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      })

      const newStatus = paymentResponse.success
        ? TransactionStatus.PAYMENT_COMPLETED
        : TransactionStatus.PAYMENT_FAILED

      await prismaClient.transaction.update({
        data: { status: newStatus },
        where: { id: transactionRecord.id },
      })

      this.logger.info(
        `[Stellar transaction]: Payment ${paymentResponse.success ? 'completed' : 'failed'} for transaction:`,
        transactionRecord.id,
      )

      if (paymentResponse.success) {
        this.slackNotifier.sendMessage(
          `Payment completed for transaction: ${transactionRecord.id}, ${transactionRecord.quote.sourceAmount} ${transactionRecord.quote.cryptoCurrency} -> ${transactionRecord.quote.targetAmount} ${transactionRecord.quote.targetCurrency}`,
        )
      }
    }
    catch (paymentError) {
      this.logger.error(
        '[Stellar transaction]: Payment processing error:',
        paymentError,
      )
      await prismaClient.transaction.update({
        data: { status: TransactionStatus.PAYMENT_FAILED },
        where: { id: transactionRecord.id },
      })
    }
  }
}
