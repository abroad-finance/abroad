import { Message, PubSub, Subscription } from '@google-cloud/pubsub'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../config/runtime'
import { ILogger, IQueueHandler, QueueName } from '../interfaces'
import { ISecretManager } from '../interfaces/ISecretManager'
import { createScopedLogger, ScopedLogger } from '../shared/logging'
import { generateCorrelationId, runWithCorrelationId } from '../shared/requestContext'
import { TYPES } from '../types'

@injectable()
export class GCPPubSubQueueHandler implements IQueueHandler {
  private readonly ackDeadlineSeconds: number
  private readonly logger: ScopedLogger
  private pubsub!: PubSub
  private subscriptions = new Map<QueueName, Subscription>()
  private readonly subscriptionSuffix: string

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    @inject(TYPES.AppConfig) config: RuntimeConfiguration,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'PubSubQueueHandler' })
    this.ackDeadlineSeconds = config.pubSub.ackDeadlineSeconds
    this.subscriptionSuffix = config.pubSub.subscriptionSuffix
  }

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
    this.logger.child({ staticPayload: { queueName } }).info('Message published to PubSub topic')
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
    const subscriptionLogger = this.logger.child({ staticPayload: { queueName, subscriptionName } })
    subscription.on('message', async (msg) => {
      const correlationId = generateCorrelationId(msg.id)
      await runWithCorrelationId(correlationId, async () => {
        const data = this.parseMessage(msg, subscriptionLogger)
        if (!data) {
          msg.ack()
          return
        }
        subscriptionLogger.info('Received message from PubSub', { messageId: msg.id })
        try {
          await Promise.resolve(callback(data))
          msg.ack()
        }
        catch (err) {
          subscriptionLogger.error('Error handling PubSub message', err)
          msg.nack?.()
        }
      })
    })
    subscription.on('error', (err) => {
      subscriptionLogger.error('Subscription error', { err })
    })
    subscriptionLogger.info('Subscribed to PubSub topic')
  }

  private async ensureClient(): Promise<void> {
    if (!this.pubsub) {
      const projectId = await this.secretManager.getSecret('GCP_PROJECT_ID')
      this.pubsub = new PubSub({ projectId })
    }
  }

  private parseMessage(msg: Message, logger: ScopedLogger): Record<string, boolean | number | string> | undefined {
    try {
      return JSON.parse(msg.data.toString()) as Record<string, boolean | number | string>
    }
    catch (err) {
      logger.warn('Failed to parse PubSub message', { err, messageId: msg.id })
      return undefined
    }
  }
}
