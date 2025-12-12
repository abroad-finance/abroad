import { Message, PubSub, Subscription } from '@google-cloud/pubsub'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../config/runtime'
import {
  ILogger,
  IQueueHandler,
  QueueName,
  QueuePayloadByName,
  QueueSubscriber,
} from '../interfaces'
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

  public async postMessage<Name extends QueueName>(
    queueName: Name,
    message: QueuePayloadByName[Name],
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

  public async subscribeToQueue<Name extends QueueName>(
    queueName: Name,
    callback: QueueSubscriber<Name>,
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
      const scopedLogger = subscriptionLogger.child({
        correlationId,
        staticPayload: { messageId: msg.id },
      })
      await runWithCorrelationId(correlationId, async () => {
        const data = this.parseMessage<Name>(msg, scopedLogger)
        if (!data) {
          scopedLogger.warn('Dropping message due to parse failure')
          msg.ack()
          return
        }
        scopedLogger.info('Received message from PubSub')
        try {
          await Promise.resolve(callback(data))
          scopedLogger.info('Acking message')
          msg.ack()
        }
        catch (err) {
          scopedLogger.error('Error handling PubSub message', err)
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

  private parseMessage<Name extends QueueName>(
    msg: Message,
    logger: ScopedLogger,
  ): QueuePayloadByName[Name] | undefined {
    try {
      return JSON.parse(msg.data.toString()) as QueuePayloadByName[Name]
    }
    catch (err) {
      logger.warn('Failed to parse PubSub message', { err, messageId: msg.id })
      return undefined
    }
  }
}
