import { injectable } from "inversify";
import * as amqplib from "amqplib";
import { connect, AmqpConnectionManager, ChannelWrapper } from "amqp-connection-manager";
import { IQueueHandler, QueueName } from "../interfaces";

@injectable()
export class RabbitMQQueueHandler implements IQueueHandler {
  private connection: AmqpConnectionManager;
  private channels: Map<QueueName, ChannelWrapper> = new Map();

  constructor() {
    // In a production setting, the URL could be injected or read from a secure source.
    const url = process.env.RABBITMQ_URL || "amqp://localhost";
    this.connection = connect([url]);
    this.connection.on("connect", () =>
      console.log("Connected to RabbitMQ")
    );
    this.connection.on("disconnect", (params) => {
      console.error("Disconnected from RabbitMQ. Reconnecting...", params.err);
    });
  }

  /**
   * Lazily creates and caches a channel for the given queue name.
   */
  private getChannel(queueName: QueueName): Promise<ChannelWrapper> {
    if (!this.channels.has(queueName)) {
      const channelWrapper = this.connection.createChannel({
        setup: async (channel: amqplib.Channel) => {
          await channel.assertQueue(queueName, { durable: true });
        },
      });
      this.channels.set(queueName, channelWrapper);
    }
    return Promise.resolve(this.channels.get(queueName)!);
  }

  /**
   * Publishes a message to the specified queue.
   */
  postMessage(queueName: QueueName, message: Record<string, any>): void {
    this.getChannel(queueName)
      .then((channel) => {
        channel.sendToQueue(
          queueName,
          Buffer.from(JSON.stringify(message)),
          { persistent: true }
        );
      })
      .catch((error) => {
        console.error("Error posting message:", error);
      });
  }

  /**
   * Subscribes to messages on the specified queue.
   */
  subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, any>) => void
  ): void {
    this.getChannel(queueName)
      .then((channel) => {
        channel.addSetup(async (channel: amqplib.Channel) => {
          await channel.consume(queueName, (msg) => {
            if (msg) {
              try {
                const message = JSON.parse(msg.content.toString());
                callback(message);
                channel.ack(msg);
              } catch (error) {
                console.error("Error processing message:", error);
              }
            }
          });
        });
      })
      .catch((error) => {
        console.error("Error subscribing to queue:", error);
      });
  }
}
