// src/stellar/transactionConsumer.ts
import type { Channel, ConsumeMessage } from "amqplib";
import { prismaClientProvider } from "../container";
import {
  BlockchainNetwork,
  CryptoCurrency,
  TransactionStatus,
} from "@prisma/client";

export interface TransactionQueueMessage {
  onChainId: string;
  amount: number;
  transactionId: string;
  cryptoCurrency: CryptoCurrency;
  blockchain: BlockchainNetwork;
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
      // Convert the message content from Buffer to JSON
      const transaction = JSON.parse(
        msg.content.toString(),
      ) as TransactionQueueMessage;

      console.log("Received transaction from queue:", transaction.onChainId);

      const prismaClient = await prismaClientProvider.getClient();

      const dbTransaction = await prismaClient.transaction.findFirst({
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
          "Transaction not found in database:",
          transaction.transactionId,
        );
        return;
      }

      await prismaClient.transaction.update({
        where: {
          id: dbTransaction.id,
        },
        data: {
          onChainId: transaction.onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
      });

      if (transaction.amount < dbTransaction.quote.sourceAmount) {
      }

      // Acknowledge the message so it can be removed from the queue
      channel.ack(msg);
    } catch (error) {
      console.error("Error processing message:", error);
      // Optionally reject the message and re-queue or dead-letter
      // channel.nack(msg, false, true);
    }
  });

  console.log(`Consuming messages from queue: ${queueName}`);
}
