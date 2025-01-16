#!/usr/bin/env -S npx tsx
import 'dotenv/config';
import { Horizon } from '@stellar/stellar-sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as amqplib from 'amqplib';

/**
 * Fetch a secret value from Google Cloud Secret Manager.
 */
async function getSecret(secretName: string): Promise<string> {
  const projectId = process.env.GCP_PROJECT_ID;

  if (!projectId) {
    throw new Error('Environment variable GCP_PROJECT_ID is not set.');
  }

  const client = new SecretManagerServiceClient();
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

  const [accessResponse] = await client.accessSecretVersion({ name });
  const payload = accessResponse.payload?.data?.toString();

  if (!payload) {
    throw new Error('No secret payload found for secret ' + secretName);
  }

  return payload;
}

/**
 * Listens to "payment" operations for the given accountId,
 * and publishes messages to RabbitMQ for each transaction.
 */
export async function listenReceivedTransactions(accountId: string) {
  // Get Horizon URL from secret manager.
  const horizonUrl = await getSecret('horizon-url');
  const server = new Horizon.Server(horizonUrl);

  // Get RabbitMQ connection string from secret manager (or environment).
  // E.g., 'amqp://user:password@host:5672'
  const rabbitmqUrl = await getSecret('rabbitmq-url');

  // Create a connection and a channel to RabbitMQ.
  const connection = await amqplib.connect(rabbitmqUrl);
  const channel = await connection.createChannel();

  // Name of the queue where transactions will be published.
  const queueName = 'stellar-transactions';

  // Make sure the queue exists. Durable = true so messages are persisted.
  await channel.assertQueue(queueName, { durable: true });

  server
    .payments()
    .cursor('now')
    .forAccount(accountId)
    .stream({
      onmessage: async (record) => {
        // We only care about payment operations for our specific account.
        if (record.type !== 'payment' || record.to !== accountId) {
          return;
        }

        // Fetch the transaction associated with this payment.
        const txResponse = await record.transaction();

        console.log('Received transaction:', txResponse);

        // Publish the transaction to RabbitMQ.
        channel.sendToQueue(
          queueName,
          Buffer.from(JSON.stringify(txResponse)),
          { persistent: true }
        );
      },
      onerror: (error) => {
        console.error('Stream error:', error);
      },
    });
}

/**
 * Main function to retrieve Stellar account ID and start listening to transactions.
 */
async function main() {
  try {
    const STELLAR_ACCOUNT_SECRET_NAME = "stellar-account-id";
    const accountId = await getSecret(STELLAR_ACCOUNT_SECRET_NAME);

    // Start listening to received transactions on the specified account.
    await listenReceivedTransactions(accountId);
  } catch (error) {
    console.error('Error fetching received transactions:', error);
  }
}

if (require.main === module) {
  void main();
}
