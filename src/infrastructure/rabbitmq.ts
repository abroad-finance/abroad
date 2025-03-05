import * as amqplib from "amqplib";
import {
  connect,
  AmqpConnectionManager,
  ChannelWrapper,
} from "amqp-connection-manager";
import { IQueueHandler, QueueName } from "../interfaces";
import { inject } from "inversify";
import { TYPES } from "../types";
import { ISecretManager } from "../interfaces/ISecretManager";

export class RabbitMQQueueHandler implements IQueueHandler {
  private connection!: AmqpConnectionManager;
  private channels: Map<QueueName, ChannelWrapper> = new Map();

  // Constructor remains lean; initialization is performed asynchronously.
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {}

  /**
   * Asynchronously initializes the connection by retrieving the RabbitMQ URL
   * from the secret manager.
   */
  public async init(): Promise<void> {
    // Retrieve the RabbitMQ URL from the secret manager.
    // If not found, fall back to "amqp://localhost".
    const url =
      (await this.secretManager.getSecret("RABBITMQ_URL")) ||
      "amqp://localhost";

    this.connection = connect([url]);
    this.connection.on("connect", () =>
      console.log("[IQueueHandler] Connected to RabbitMQ"),
    );
    this.connection.on("disconnect", (params) => {
      console.error(
        "[IQueueHandler] Disconnected from RabbitMQ. Reconnecting...",
        params.err,
      );
    });
  }

  /**
   * Lazily creates and caches a channel for the given queue name.
   */
  private getChannel(queueName: QueueName): Promise<ChannelWrapper> {
    if (!this.channels.has(queueName)) {
      console.log(`[IQueueHandler] Creating channel for queue: ${queueName}`);
      const channelWrapper = this.connection.createChannel({
        setup: async (channel: amqplib.Channel) => {
          console.log(`[IQueueHandler] Asserting queue: ${queueName}`);
          await channel.assertQueue(queueName, { durable: true });
          console.log(`[IQueueHandler] Queue ${queueName} asserted.`);
        },
      });
      this.channels.set(queueName, channelWrapper);
    } else {
      console.log(`[IQueueHandler] Reusing channel for queue: ${queueName}`);
    }
    return Promise.resolve(this.channels.get(queueName)!);
  }

  /**
   * Publishes a message to the specified queue.
   */
  async postMessage(
    queueName: QueueName,
    message: Record<string, any>,
  ): Promise<void> {
    await this.init();
    this.getChannel(queueName)
      .then((channel) => {
        console.log(`[IQueueHandler] Posting message to queue: ${queueName}`);
        channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
          persistent: true,
        });
        console.log(`[IQueueHandler] Message posted to queue: ${queueName}`);
      })
      .catch((error) => {
        console.error("[IQueueHandler] Error posting message:", error);
      });
  }

  /**
   * Subscribes to messages on the specified queue.
   */
  async subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, any>) => void,
  ): Promise<void> {
    await this.init();
    console.log(`[IQueueHandler] Subscribing to queue: ${queueName}`);
    this.getChannel(queueName)
      .then((channel) => {
        channel.addSetup(async (channel: amqplib.Channel) => {
          console.log(
            `[IQueueHandler] Setting up consumer for queue: ${queueName}`,
          );
          await channel.consume(queueName, (msg) => {
            if (msg) {
              try {
                const message = JSON.parse(msg.content.toString());
                console.log(
                  `[IQueueHandler] Received message from queue: ${queueName}`,
                );
                callback(message);
                channel.ack(msg);
                console.log(
                  `[IQueueHandler] Message acknowledged on queue: ${queueName}`,
                );
              } catch (error) {
                console.error(
                  "[IQueueHandler] Error processing message:",
                  error,
                );
              }
            }
          });
          console.log(
            `[IQueueHandler] Consumer set up for queue: ${queueName}`,
          );
        });
      })
      .catch((error) => {
        console.error("[IQueueHandler] Error subscribing to queue:", error);
      });
  }
}
