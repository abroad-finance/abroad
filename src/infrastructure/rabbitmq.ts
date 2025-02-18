// src/infrastructure/rabbitmq.ts
import * as amqplib from 'amqplib';
import { connect, AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { secretManager } from '../container';

export async function createManagedConnection(): Promise<AmqpConnectionManager> {
  const RABBITMQ_URL = await secretManager.getSecret('RABBITMQ_URL');
  const connection = connect([RABBITMQ_URL]);
  
  connection.on('connect', () => console.log('Connected to RabbitMQ'));
  connection.on('disconnect', params => {
    console.error('Disconnected from RabbitMQ. Reconnecting...', params.err);
  });
  
  return connection;
}

export function setupChannel(connection: AmqpConnectionManager, queueName: string): ChannelWrapper {
  return connection.createChannel({
    setup: async (channel: amqplib.Channel) => {
      await channel.assertQueue(queueName, { durable: true });
    }
  });
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
