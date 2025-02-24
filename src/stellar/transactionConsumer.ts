// src/stellar/transactionConsumer.ts
import type { Channel, ConsumeMessage } from "amqplib";
import { nequiPaymentService, prismaClientProvider } from "../container";
import {
  BlockchainNetwork,
  CryptoCurrency,
  TransactionStatus,
} from "@prisma/client";
import z from "zod";

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

/**
 * Consumes messages from the specified queue and processes them.
 */
export function consumeTransactions(channel: Channel, queueName: string) {
  channel.consume(queueName, async (msg: ConsumeMessage | null) => {
    if (!msg) {
      return;
    }
    try {
      const parsedMessage = TransactionQueueMessageSchema.parse(
        JSON.parse(msg.content.toString()),
      );
      const transaction = parsedMessage as TransactionQueueMessage;

      console.log("Received transaction from queue:", transaction.onChainId);

      const prismaClient = await prismaClientProvider.getClient();

      await prismaClient.$transaction(
        async (prisma) => {
          // Start transaction
          const dbTransaction = await prisma.transaction.findFirst({
            where: {
              id: transaction.transactionId,
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
              transaction.transactionId,
            );
            return;
          }

          await prisma.transaction.update({
            where: {
              id: dbTransaction.id,
            },
            data: {
              onChainId: transaction.onChainId,
              status: TransactionStatus.PROCESSING_PAYMENT,
            },
          });

          if (transaction.amount < dbTransaction.quote.sourceAmount) {
            console.log(
              "Transaction amount does not match quote:",
              transaction.amount,
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

      // Acknowledge the message so it can be removed from the queue
      channel.ack(msg);
    } catch (error) {
      console.error("Error processing message:", error);
      channel.nack(msg, false, false);
    }
  });

  console.log(`Consuming messages from queue: ${queueName}`);
}
