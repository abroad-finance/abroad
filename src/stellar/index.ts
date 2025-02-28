#!/usr/bin/env -S npx tsx
import { Horizon } from "@stellar/stellar-sdk";
import { prismaClientProvider, secretManager } from "../container";
import { BlockchainNetwork, CryptoCurrency } from "@prisma/client";
import { TransactionQueueMessage } from "../controllers/queue/StellarTransactionsController";
import { inject } from "inversify";
import { IQueueHandler, QueueName } from "../interfaces";
import { iocContainer } from "../ioc";
import { TYPES } from "../types";

class StellarListener {
  private accountId!: string;
  private horizonUrl!: string;
  private queueName = QueueName.STELLAR_TRANSACTIONS;

  constructor(
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
  ) { }

  /**
   * Converts a Base64 string to a UUID string.
   */
  private static base64ToUuid(base64: string): string {
    const buffer = Buffer.from(base64, "base64");
    const hex = buffer.toString("hex");
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join("-");
  }

  /**
   * Listens to Stellar "payment" operations for the given account and
   * publishes valid messages to the RabbitMQ queue.
   */
  public async start(): Promise<void> {
    console.log(`[StellarListener] Initializing listener`);

    this.accountId = await secretManager.getSecret("stellar-account-id");
    this.horizonUrl = await secretManager.getSecret("horizon-url");

    console.log(`[StellarListener] Initializing Horizon server for account:`, this.accountId);

    const server = new Horizon.Server(this.horizonUrl);
    const prismaClient = await prismaClientProvider.getClient();

    const state = await prismaClient.stellarListenerState.findUnique({
      where: { id: "singleton" },
    });
    console.log(`[StellarListener] Retrieved listener state:`, state);

    const cursorServer = state?.lastPagingToken
      ? server.payments().cursor(state.lastPagingToken)
      : server.payments();
    console.log(
      `[StellarListener] Starting stream. Cursor initialized to:`,
      state?.lastPagingToken ? state.lastPagingToken : "now",
    );

    cursorServer.forAccount(this.accountId).stream({
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
          console.log(
            `[StellarListener] Skipping message (wrong type):`,
            payment,
          );
          return;
        }

        // Filter for USDC payments
        if (
          payment.to !== this.accountId ||
          payment.asset_type !== "credit_alphanum4" ||
          payment.asset_code !== "USDC" ||
          !payment.asset_issuer
        ) {
          console.log(
            `[StellarListener] Skipping message (wrong type, recipient, or asset). Type: ${payment.type}, Asset Type: ${payment.asset_type}, Asset Code: ${payment.asset_code}, Asset Issuer: ${payment.asset_issuer}`,
          );
          return;
        }

        const usdcAssetIssuers = [
          "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        ];

        if (!usdcAssetIssuers.includes(payment.asset_issuer)) {
          console.log(
            `[StellarListener] Skipping payment. USDC Asset Issuer ${payment.asset_issuer} is not allowed.`,
          );
          return;
        }

        const tx = await payment.transaction();
        console.log(
          `[StellarListener] Fetched full transaction details:`,
          tx.id,
        );

        if (!tx.memo) {
          console.log(
            `[StellarListener] Skipping message (no memo) in payment:`,
            payment.id,
          );
          return;
        }

        // Convert memo to a UUID if needed
        const transactionId = StellarListener.base64ToUuid(tx.memo);

        const queueMessage: TransactionQueueMessage = {
          transactionId: transactionId,
          amount: parseFloat(payment.amount),
          cryptoCurrency: CryptoCurrency.USDC,
          blockchain: BlockchainNetwork.STELLAR,
          onChainId: payment.id,
        };

        try {
          this.queueHandler.postMessage(this.queueName, queueMessage);
          console.log(
            `[StellarListener] Sent message to RabbitMQ queue '${this.queueName}':`,
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
}

if (require.main === module) {
  iocContainer.bind<StellarListener>("StellarListener").to(StellarListener);
  const stellarListener = iocContainer.get<StellarListener>("StellarListener");
  stellarListener.start();
}
