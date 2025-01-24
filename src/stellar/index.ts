#!/usr/bin/env -S npx tsx
// src/stellar/index.ts

import { getSecret } from '../environment/secretManager';
import { createRabbitMQConnection, assertQueue } from '../infrastructure/rabbitmq';
import { listenReceivedTransactions } from './stellarListener';
import { consumeTransactions } from './transactionConsumer';

/**
 * Main function to retrieve Stellar account ID and start listening to transactions.
 */
async function startStellarListener() {
  try {
    const accountId = await getSecret('stellar-account-id');
    const horizonUrl = await getSecret('horizon-url');

    const { connection, channel } = await createRabbitMQConnection();

    const queueName = 'stellar-transactions';
    await assertQueue(channel, queueName);

    await listenReceivedTransactions({
      accountId,
      horizonUrl,
      channel,
      queueName,
    });

    console.log(`Listening for payments on account: ${accountId}`);
  } catch (error) {
    console.error('Error fetching received transactions:', error);
  }
}

export async function registerConsumers() {
  try {
    const { connection, channel } = await createRabbitMQConnection();

    const queueName = 'stellar-transactions';
    await assertQueue(channel, queueName);

    consumeTransactions(channel, queueName);

    console.log('Consumer is now running. Press CTRL+C to exit.');
  } catch (error) {
    console.error('Error in consumer:', error);
  }
}

if (require.main === module) {
  void startStellarListener();
}
