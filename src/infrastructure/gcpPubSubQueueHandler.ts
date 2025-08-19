import { PubSub, Subscription } from '@google-cloud/pubsub'
import { inject, injectable } from 'inversify'

import { IQueueHandler, QueueName } from '../interfaces'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

@injectable()
export class GCPPubSubQueueHandler implements IQueueHandler {
  private pubsub!: PubSub
  private subscriptions = new Map<QueueName, Subscription>()

  constructor(
        @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
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
    console.log(`[IQueueHandler] Message published to PubSub topic: ${queueName}`)
  }

  public async subscribeToQueue(
    queueName: QueueName,
    callback: (message: Record<string, boolean | number | string>) => void,
  ): Promise<void> {
    await this.ensureClient()
    const topic = this.pubsub.topic(queueName)
    const [exists] = await topic.exists()
    if (!exists) {
      await this.pubsub.createTopic(queueName)
    }
    const subscriptionName = `${queueName}-subscription`
    const subscription = this.pubsub.subscription(subscriptionName)
    this.subscriptions.set(queueName, subscription)
    const [subExists] = await subscription.exists()
    if (!subExists) {
      await topic.createSubscription(subscriptionName)
      console.log(`[IQueueHandler] Created subscription: ${subscriptionName}`)
    }
    subscription.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.data.toString())
        console.log(`[IQueueHandler] Received message from PubSub: ${queueName}`)
        callback(data)
        msg.ack()
      }
      catch (err) {
        console.error('[IQueueHandler] Error handling PubSub message', err)
      }
    })
    console.log(`[IQueueHandler] Subscribed to PubSub topic: ${queueName}`)
  }

  private async ensureClient(): Promise<void> {
    if (!this.pubsub) {
      const projectId = await this.secretManager.getSecret('GCP_PROJECT_ID')
      this.pubsub = new PubSub({ projectId })
    }
  }
}
