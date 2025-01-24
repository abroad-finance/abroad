// src/stellar/transactionConsumer.ts
import { Horizon } from '@stellar/stellar-sdk';
import type { Channel, ConsumeMessage } from 'amqplib';

/**
 * Consumes messages from the specified queue and processes them.
 */
export function consumeTransactions(channel: Channel, queueName: string) {
    channel.consume(queueName, (msg: ConsumeMessage | null) => {
        if (msg) {
            try {
                // Convert the message content from Buffer to JSON
                const content = JSON.parse(msg.content.toString()) as Horizon.ServerApi.TransactionRecord;

                console.log('Received transaction from queue:', content.paging_token);

                // TODO: handle the transaction data
                // e.g., store in a database, call external APIs, etc.

                // Acknowledge the message so it can be removed from the queue
                channel.ack(msg);
            } catch (error) {
                console.error('Error processing message:', error);
                // Optionally reject the message and re-queue or dead-letter
                // channel.nack(msg, false, true);
            }
        }
    });

    console.log(`Consuming messages from queue: ${queueName}`);
}
