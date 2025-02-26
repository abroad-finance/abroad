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


function uuidToBase64(uuid: string): string {
  // Remove hyphens from the UUID
  const hex = uuid.replace(/-/g, '');
  // Convert hex string to a Buffer
  const buffer = Buffer.from(hex, 'hex');
  // Encode the Buffer to a Base64 string
  return buffer.toString('base64');
}

function base64ToUuid(base64: string): string {
  // Decode the Base64 string into a Buffer
  const buffer = Buffer.from(base64, 'base64');
  // Convert the Buffer to a hexadecimal string
  const hex = buffer.toString('hex');
  // Insert hyphens to format it as a UUID
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20)
  ].join('-');
}

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
      const transaction = {
        ...parsedMessage,
        transactionId: base64ToUuid(parsedMessage.transactionId),
      } satisfies TransactionQueueMessage;

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