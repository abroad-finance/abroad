#!/usr/bin/env -S npx tsx
// src/stellar/index.ts

import { Channel } from 'amqplib';
import { getSecret } from '../environment/secretManager';
import { createManagedConnection, assertQueue, setupChannel } from '../infrastructure/rabbitmq';
import { listenReceivedTransactions } from './stellarListener';
import { consumeTransactions } from './transactionConsumer';

/**
 * Main function to retrieve Stellar account ID and start listening to transactions.
 */
async function startStellarListener() {
  try {
    const accountId = await getSecret('stellar-account-id');
    const horizonUrl = await getSecret('horizon-url');

    const connection = await createManagedConnection();

    const queueName = 'stellar-transactions';

    const channelWrapper = await setupChannel(connection, queueName);

    channelWrapper.addSetup(async (channel: Channel) => {

      await listenReceivedTransactions({
        accountId,
        horizonUrl,
        channel,
        queueName,
      });

      console.log(`Listening for payments on account: ${accountId}`);
    });
  } catch (error) {
    console.error('Error fetching received transactions:', error);
  }
}

export async function registerConsumers() {
  try {
    const connection = await createManagedConnection();

    const queueName = 'stellar-transactions';
    const channelWrapper = await setupChannel(connection, queueName);

    channelWrapper.addSetup(async (channel: Channel) => {
      consumeTransactions(channel, queueName);
      console.log('Consumer is now running');
    });

  } catch (error) {
    console.error('Error in consumer:', error);
  }
}

if (require.main === module) {
  void startStellarListener();
}
