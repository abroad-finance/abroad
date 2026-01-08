import { Message, PubSub, Subscription } from '@google-cloud/pubsub'
import { inject, injectable } from 'inversify'

import { RuntimeConfiguration } from '../../app/config/runtime'
import { TYPES } from '../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../core/logging/scopedLogger'
import { ILogger } from '../../core/logging/types'
import { generateCorrelationId, runWithCorrelationId } from '../../core/requestContext'
import { ISecretManager } from '../secrets/ISecretManager'
import {
  IQueueHandler,
  QueueName,
  QueuePayloadByName,
  QueuePayloadSchemaByName,
  QueueSubscriber,
} from './queues'

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
        const { parsed, raw } = this.parseMessage<Name>(queueName, msg, scopedLogger)
        if (!parsed) {
          scopedLogger.warn('Dropping message due to parse failure')
          await this.sendToDeadLetter(queueName, raw, 'parse_failed')
          msg.ack()
          return
        }
        scopedLogger.info('Received message from PubSub')
        try {
          await Promise.resolve(callback(parsed))
          scopedLogger.info('Acking message')
          msg.ack()
        }
        catch (err) {
          scopedLogger.error('Error handling PubSub message', err)
          await this.sendToDeadLetter(queueName, parsed, 'handler_failed', err)
          msg.ack()
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
    queueName: Name,
    msg: Message,
    logger: ScopedLogger,
  ): { parsed?: QueuePayloadByName[Name], raw: unknown } {
    let payload: unknown
    try {
      payload = JSON.parse(msg.data.toString())
    }
    catch (err) {
      logger.warn('Failed to parse PubSub message', { err, messageId: msg.id })
      return { raw: msg.data.toString() }
    }

    const schema = QueuePayloadSchemaByName[queueName]
    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      logger.warn('Failed to validate PubSub message', {
        issues: parsed.error.issues,
        messageId: msg.id,
      })
      return { raw: payload }
    }

    return { parsed: parsed.data, raw: payload }
  }

  private async sendToDeadLetter(
    queueName: QueueName,
    payload: unknown,
    reason: string,
    error?: unknown,
  ): Promise<void> {
    if (queueName === QueueName.DEAD_LETTER) {
      return
    }

    try {
      const message: QueuePayloadByName[QueueName.DEAD_LETTER] = {
        error: this.normalizeError(error),
        originalQueue: queueName,
        payload,
        reason,
      }
      await this.postMessage(QueueName.DEAD_LETTER, message)
    }
    catch (dlqError) {
      this.logger.error('Failed to post message to dead-letter queue', dlqError)
    }
  }

  private normalizeError(error: unknown): string | undefined {
    if (error instanceof Error) {
      return error.message
    }
    if (typeof error === 'string') {
      return error
    }
    return undefined
  }
}
