#!/usr/bin/env -S npx tsx
// src/stellar/index.ts

import { Channel } from "amqplib";
import {
  createManagedConnection,
  setupChannel,
} from "../infrastructure/rabbitmq";
import { listenReceivedTransactions } from "./stellarListener";
import { secretManager } from "../container";

/**
 * Main function to retrieve Stellar account ID and start listening to transactions.
 */
async function startStellarListener() {
  try {
    console.log("Starting Stellar Listener...");
    const accountId = await secretManager.getSecret("stellar-account-id");
    const horizonUrl = await secretManager.getSecret("horizon-url");

    const connection = await createManagedConnection();
    console.log("Connected to RabbitMQ");

    const queueName = "stellar-transactions";

    const channelWrapper = await setupChannel(connection, queueName);
    console.log(`Channel for queue ${queueName} created`);

    channelWrapper.addSetup(async (channel: Channel) => {
      console.log(`Listening for payments on account: ${accountId}`);
      await listenReceivedTransactions({
        accountId,
        horizonUrl,
        channel,
        queueName,
      });
    });
  } catch (error) {
    console.error("Error fetching received transactions:", error);
  }
}



if (require.main === module) {
  void startStellarListener();
}
