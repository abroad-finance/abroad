// src/stellar/transactionConsumer.ts
import {
  BlockchainNetwork,
  CryptoCurrency,
  TransactionStatus,
} from "@prisma/client";
import z from "zod";
import { nequiPaymentService, prismaClientProvider } from "../../container";
import { inject } from "inversify";
import { IQueueHandler, QueueName } from "../../interfaces";
import { TYPES } from "../../types";

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
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
  ) {}

  /**
   * Consumes messages from the specified queue and processes them.
   */
  private async onTransactionReceived(msg: Record<string, any>): Promise<void> {
    if (!msg) {
      return;
    }
    try {
      const message = TransactionQueueMessageSchema.parse(
        JSON.parse(msg.content.toString()),
      ) satisfies TransactionQueueMessage;

      console.log("Received transaction from queue:", message.onChainId);

      const prismaClient = await prismaClientProvider.getClient();

      await prismaClient.$transaction(
        async (prisma) => {
          // Start transaction
          const dbTransaction = await prisma.transaction.findFirst({
            where: {
              id: message.transactionId,
              onChainId: null,
              status: TransactionStatus.AWAITING_PAYMENT,
            },
            include: {
              quote: true,
            },
          });

          if (!dbTransaction) {
            console.log(
              "Transaction not found or already processed:",
              message.transactionId,
            );
            return;
          }

          await prisma.transaction.update({
            where: {
              id: dbTransaction.id,
            },
            data: {
              onChainId: message.onChainId,
              status: TransactionStatus.PROCESSING_PAYMENT,
            },
          });

          if (message.amount < dbTransaction.quote.sourceAmount) {
            console.log(
              "Transaction amount does not match quote:",
              message.amount,
              dbTransaction.quote.sourceAmount,
            );
            return;
          }

          const response = await nequiPaymentService.sendPayment({
            account: dbTransaction.accountNumber,
            id: dbTransaction.id,
            value: dbTransaction.quote.targetAmount,
          });

          if (
            response.ResponseMessage.ResponseHeader.Status.StatusDesc !==
            "SUCCESS"
          ) {
            await prismaClient.transaction.update({
              where: {
                id: dbTransaction.id,
              },
              data: {
                status: TransactionStatus.PAYMENT_FAILED,
              },
            });
          } else {
            await prismaClient.transaction.update({
              where: {
                id: dbTransaction.id,
              },
              data: {
                status: TransactionStatus.PAYMENT_COMPLETED,
              },
            });
          }
        },
        {
          isolationLevel: "Serializable", // Or 'ReadCommitted', depending on your needs
        },
      );
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }

  public registerConsumers() {
    try {
      this.queueHandler.subscribeToQueue(
        QueueName.STELLAR_TRANSACTIONS,
        this.onTransactionReceived.bind(this),
      );
    } catch (error) {
      console.error("Error in consumer:", error);
    }
  }
}
