// src/stellar/stellarListener.ts
import { Horizon } from "@stellar/stellar-sdk";
import type { Channel } from "amqplib";
import { sendMessage } from "../infrastructure/rabbitmq";
import { prismaClientProvider } from "../container";
import { BlockchainNetwork, CryptoCurrency } from "@prisma/client";
import { TransactionQueueMessage } from "../controllers/queue/StellarTransactionsController";

interface ListenOptions {
  accountId: string;
  horizonUrl: string;
  channel: Channel;
  queueName: string;
}

/**
 * Listens to "payment" operations for the given accountId and
 * publishes messages to RabbitMQ for each transaction.
 */
export async function listenReceivedTransactions(options: ListenOptions) {
  const { accountId, horizonUrl, channel, queueName } = options;
  console.log(`[StellarListener] Initializing listener`);

  const server = new Horizon.Server(horizonUrl);
  const prismaClient = await prismaClientProvider.getClient();

  const state = await prismaClient.stellarListenerState.findUnique({
    where: { id: "singleton" },
  });
  console.log(`[StellarListener] Retrieved listener state:`, state);

  const cursorServer = state?.lastPagingToken
    ? server.payments().cursor(state.lastPagingToken)
    : server.payments();
  console.log(
    `[StellarListener] Starting stream.  Cursor initialized to:`,
    state?.lastPagingToken ? state.lastPagingToken : "now",
  );

  cursorServer.forAccount(accountId).stream({
    onmessage: async (payment) => {
      console.log(
        `[StellarListener] Received message from stream:`,
        payment.id,
      );

      try {
        await prismaClient.stellarListenerState.upsert({
          where: { id: "singleton" },
          update: { lastPagingToken: payment.paging_token },
          create: {
            id: "singleton",
            lastPagingToken: payment.paging_token,
          },
        });
        console.log(
          `[StellarListener] Updated listener state with paging token:`,
          payment.paging_token,
        );
      } catch (error) {
        console.error(
          `[StellarListener] Error updating listener state:`,
          error,
        );
      }

      if (payment.type !== "payment") {
        console.log(`[StellarListener] Skipping message (wrong type):`, payment);
        return;
      }

      // // Filter for USDC payments
      // if (
      //   payment.to !== accountId ||
      //   payment.asset_type !== "credit_alphanum4" ||
      //   payment.asset_code !== "USDC" ||
      //   !payment.asset_issuer
      // ) {
      //   console.log(
      //     `[StellarListener] Skipping message (wrong type, recipient, or asset). Type: ${payment.type}, Asset Type: ${payment.asset_type}, Asset Code: ${payment.asset_code}, Asset Issuer: ${payment.asset_issuer}`,
      //   );
      //   return;
      // }

      // const usdcAssetIssuers = [
      //   "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      // ];

      // if (!usdcAssetIssuers.includes(payment.asset_issuer)) {
      //   console.log(
      //     `[StellarListener] Skipping payment.  USDC Asset Issuer ${payment.asset_issuer} is not in the allowed list.`,
      //   );
      //   return;
      // }

      const tx = await payment.transaction();
      console.log(`[StellarListener] Fetched full transaction details:`, tx.id);

      if (!tx.memo) {
        console.log(
          `[StellarListener] Skipping message (no memo) in payment:`,
          payment.id,
        );
        return;
      }

      const queueMessage = {
        transactionId: tx.memo,
        amount: parseFloat(payment.amount),
        cryptoCurrency: CryptoCurrency.USDC,
        blockchain: BlockchainNetwork.STELLAR,
        onChainId: payment.id,
      } satisfies TransactionQueueMessage;

      try {
        sendMessage(channel, queueName, queueMessage);
        console.log(
          `[StellarListener] Sent message to RabbitMQ queue '${queueName}':`,
          queueMessage,
        );
      } catch (error) {
        console.error(
          `[StellarListener] Error sending message to RabbitMQ:`,
          error,
        );
      }
    },
    onerror: (err) => {
      console.error("[StellarListener] Stream error:", err);
    },
  });
}
