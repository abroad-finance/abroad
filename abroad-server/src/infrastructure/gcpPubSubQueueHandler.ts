import { PubSub, Subscription } from '@google-cloud/pubsub'
import { inject, injectable } from 'inversify'

import { RuntimeConfig } from '../config/runtime'
import { ILogger, IQueueHandler, QueueName } from '../interfaces'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

@injectable()
export class GCPPubSubQueueHandler implements IQueueHandler {
  private readonly ackDeadlineSeconds = RuntimeConfig.pubSub.ackDeadlineSeconds
  private pubsub!: PubSub
  private subscriptions = new Map<QueueName, Subscription>()
  private readonly subscriptionSuffix = RuntimeConfig.pubSub.subscriptionSuffix

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) { }

  public async closeAllSubscriptions(): Promise<void> {
    for (const subscription of this.subscriptions.values()) {
      await subscription.close()
    }
    this.subscriptions.clear()
  }

  public async postMessage(
    queueName: QueueName,
    message: Record<string, boolean | number | string>,
  ): Promise<void> {
    await this.ensureClient()
    const topic = this.pubsub.topic(queueName)
    const [exists] = await topic.exists()
    if (!exists) {
      await this.pubsub.createTopic(queueName)
    }
    const dataBuffer = Buffer.from(JSON.stringify(message))
    await topic.publishMessage({ data: dataBuffer })
    this.logger.info('[IQueueHandler] Message published to PubSub topic', { queueName })
  }

  public async subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, boolean | number | string>) => void,
    customSubscriptionName?: string,
  ): Promise<void> {
    await this.ensureClient()
    const topic = this.pubsub.topic(queueName)
    const [exists] = await topic.exists()
    if (!exists) {
      await this.pubsub.createTopic(queueName)
    }
    const subscriptionName = customSubscriptionName || `${queueName}${this.subscriptionSuffix}`
    const subscription = this.pubsub.subscription(subscriptionName)
    this.subscriptions.set(queueName, subscription)
    const [subExists] = await subscription.exists()
    if (!subExists) {
      await topic.createSubscription(subscriptionName, { ackDeadlineSeconds: this.ackDeadlineSeconds })
      this.logger.info('[IQueueHandler] Created subscription', { queueName, subscriptionName })
    }
    subscription.on('message', async (msg) => {
      try {
        const data = this.parseMessage(msg.data)
        if (!data) {
          msg.ack()
          return
        }
        this.logger.info('[IQueueHandler] Received message from PubSub', { queueName })
        await Promise.resolve(callback(data))
        msg.ack()
      }
      catch (err) {
        this.logger.error('[IQueueHandler] Error handling PubSub message', err)
        msg.nack?.()
      }
    })
    subscription.on('error', (err) => {
      this.logger.error('[IQueueHandler] Subscription error', { err, queueName, subscriptionName })
    })
    this.logger.info('[IQueueHandler] Subscribed to PubSub topic', { queueName, subscriptionName })
  }

  private async ensureClient(): Promise<void> {
    if (!this.pubsub) {
      const projectId = await this.secretManager.getSecret('GCP_PROJECT_ID')
      this.pubsub = new PubSub({ projectId })
    }
  }

  private parseMessage(data: Buffer): Record<string, boolean | number | string> | undefined {
    try {
      return JSON.parse(data.toString()) as Record<string, boolean | number | string>
    }
    catch (err) {
      this.logger.warn('[IQueueHandler] Failed to parse PubSub message', err)
      return undefined
    }
  }
}
