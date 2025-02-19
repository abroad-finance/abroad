#!/usr/bin/env -S npx tsx
// src/stellar/index.ts

import { Channel } from 'amqplib';
import { createManagedConnection, setupChannel } from '../infrastructure/rabbitmq';
import { listenReceivedTransactions } from './stellarListener';
import { consumeTransactions } from './transactionConsumer';
import { secretManager } from '../container';
import { Logging } from '@google-cloud/logging';

// Initialize Google Cloud Logging
const logging = new Logging();
const log = logging.log('stellar-log');

// Helper function to log informational messages
function logInfo(message: string) {
  const metadata = { resource: { type: 'global' } };
  const entry = log.entry(metadata, message);
  // Write to Google Cloud Logging (non-blocking)
  log.write(entry).catch(err => console.error('Error writing log entry:', err));
  // Optionally still log to console
  console.log(message);
}

// Helper function to log errors
function logError(message: string, error?: any) {
  const metadata = { resource: { type: 'global' } };
  const entry = log.entry(metadata, { message, error });
  log.write(entry).catch(err => console.error('Error writing log entry:', err));
  console.error(message, error);
}

/**
 * Main function to retrieve Stellar account ID and start listening to transactions.
 */
async function startStellarListener() {
  try {
    const accountId = await secretManager.getSecret('stellar-account-id');
    const horizonUrl = await secretManager.getSecret('horizon-url');

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
      logInfo(`Listening for payments on account: ${accountId}`);
    });
  } catch (error) {
    logError('Error fetching received transactions:', error);
  }
}

export async function registerConsumers() {
  try {
    const connection = await createManagedConnection();

    const queueName = 'stellar-transactions';
    const channelWrapper = await setupChannel(connection, queueName);

    channelWrapper.addSetup(async (channel: Channel) => {
      consumeTransactions(channel, queueName);
      logInfo('Consumer is now running');
    });
  } catch (error) {
    logError('Error in consumer:', error);
  }
}

if (require.main === module) {
  void startStellarListener();
}
