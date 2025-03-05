// src/controllers/queue/StellarTransactionsController.ts
import {
  BlockchainNetwork,
  CryptoCurrency,
  TransactionStatus,
} from "@prisma/client";
import z from "zod";
import { inject } from "inversify";
import {
  ILogger,
  IPaymentService,
  IQueueHandler,
  QueueName,
} from "../../interfaces";
import { TYPES } from "../../types";
import { IDatabaseClientProvider } from "../../interfaces/IDatabaseClientProvider";
// Import the logger interface (adjust the path as necessary)

// Schema definition for validating the queue message
const TransactionQueueMessageSchema = z.object({
  onChainId: z.string(),
  amount: z.number().positive(),
  transactionId: z.string().uuid(),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  blockchain: z.nativeEnum(BlockchainNetwork),
});

export type TransactionQueueMessage = z.infer<
  typeof TransactionQueueMessageSchema
>;

export class StellarTransactionsController {
  public constructor(
    @inject(TYPES.IPaymentService) private paymentService: IPaymentService,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) {}

  /**
   * Processes a transaction message from the queue.
   */
  private async onTransactionReceived(msg: Record<string, any>): Promise<void> {
    if (!msg || Object.keys(msg).length === 0) {
      this.logger.warn(
        "[Stellar transaction]: Received empty message. Skipping...",
      );
      return;
    }

    // Validate and parse the message early
    let message: TransactionQueueMessage;
    try {
      message = TransactionQueueMessageSchema.parse(msg);
    } catch (error) {
      this.logger.error(
        "[Stellar transaction]: Invalid message format:",
        error,
      );
      return;
    }
    this.logger.info(
      "[Stellar transaction]: Received transaction from queue:",
      message.onChainId,
    );

    const prismaClient = await this.dbClientProvider.getClient();

    // Execute DB operations in a transaction block
    const transactionRecord = await prismaClient.$transaction(
      async (prisma) => {
        const transaction = await prisma.transaction.findFirst({
          where: {
            id: message.transactionId,
            onChainId: null,
            status: TransactionStatus.AWAITING_PAYMENT,
          },
          include: { quote: true },
        });

        if (!transaction) {
          this.logger.warn(
            "[Stellar transaction]: Transaction not found or already processed:",
            message.transactionId,
          );
          return null;
        }

        // Update transaction to indicate that payment is being processed
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            onChainId: message.onChainId,
            status: TransactionStatus.PROCESSING_PAYMENT,
          },
        });

        return transaction;
      },
      { timeout: 10000 },
    );

    if (!transactionRecord) return;

    // Validate that the amount in the message matches the expected quote
    if (message.amount < transactionRecord.quote.sourceAmount) {
      this.logger.warn(
        "[Stellar transaction]: Transaction amount does not match quote:",
        message.amount,
        transactionRecord.quote.sourceAmount,
      );
      await prismaClient.transaction.update({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.WRONG_AMOUNT },
      });
      return;
    }

    // Process the payment and update the transaction accordingly
    try {
      const paymentResponse = await this.paymentService.sendPayment({
        account: transactionRecord.accountNumber,
        id: transactionRecord.id,
        value: transactionRecord.quote.targetAmount,
      });

      const newStatus = paymentResponse.success
        ? TransactionStatus.PAYMENT_COMPLETED
        : TransactionStatus.PAYMENT_FAILED;

      await prismaClient.transaction.update({
        where: { id: transactionRecord.id },
        data: { status: newStatus },
      });

      this.logger.info(
        `[Stellar transaction]: Payment ${paymentResponse.success ? "completed" : "failed"} for transaction:`,
        transactionRecord.id,
      );
    } catch (paymentError) {
      this.logger.error(
        "[Stellar transaction]: Payment processing error:",
        paymentError,
      );
      await prismaClient.transaction.update({
        where: { id: transactionRecord.id },
        data: { status: TransactionStatus.PAYMENT_FAILED },
      });
    }
  }

  public registerConsumers() {
    try {
      this.logger.info(
        "[Stellar transaction]: Registering consumer for queue:",
        QueueName.STELLAR_TRANSACTIONS,
      );
      this.queueHandler.subscribeToQueue(
        QueueName.STELLAR_TRANSACTIONS,
        this.onTransactionReceived.bind(this),
      );
    } catch (error) {
      this.logger.error(
        "[Stellar transaction]: Error in consumer registration:",
        error,
      );
    }
  }
}
