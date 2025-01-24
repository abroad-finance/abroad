// src/infrastructure/rabbitmq.ts
import * as amqplib from 'amqplib';
import { RABBITMQ_URL } from '../environment/env';

/**
 * Create a RabbitMQ connection and a channel.
 */
export async function createRabbitMQConnection() {
    if (!RABBITMQ_URL) {
        throw new Error('Environment variable RABBITMQ_URL is not set.');
    }
    const connection = await amqplib.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    return { connection, channel };
}

/**
 * Ensure the queue exists and is durable.
 */
export async function assertQueue(channel: amqplib.Channel, queueName: string) {
    await channel.assertQueue(queueName, { durable: true });
}

/**
 * Publish a message to the specified queue.
 */
export function sendMessage(
    channel: amqplib.Channel,
    queueName: string,
    message: Record<string, any>
) {
    channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
        persistent: true,
    });
}
