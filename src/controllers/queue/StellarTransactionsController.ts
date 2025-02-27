// src/stellar/transactionConsumer.ts
import type { Channel, ConsumeMessage } from "amqplib";
import {
  BlockchainNetwork,
  CryptoCurrency,
  TransactionStatus,
} from "@prisma/client";
import z from "zod";
import {
  createManagedConnection,
  setupChannel,
} from "../../infrastructure/rabbitmq";
import { nequiPaymentService, prismaClientProvider } from "../../container";

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

      // Acknowledge the message so it can be removed from the queue
      channel.ack(msg);
    } catch (error) {
      console.error("Error processing message:", error);
      channel.nack(msg, false, false);
    }
  });

  console.log(`Consuming messages from queue: ${queueName}`);
}

export async function registerConsumers() {
  try {
    const connection = await createManagedConnection();

    const queueName = "stellar-transactions";
    const channelWrapper = await setupChannel(connection, queueName);

    channelWrapper.addSetup(async (channel: Channel) => {
      consumeTransactions(channel, queueName);
      console.log("Consumer is now running");
    });
  } catch (error) {
    console.error("Error in consumer:", error);
  }
}
