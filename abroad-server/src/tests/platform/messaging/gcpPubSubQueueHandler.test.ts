import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import EventEmitter from 'events'

import { RuntimeConfiguration } from '../../../app/config/runtime'
import { GCPPubSubQueueHandler } from '../../../platform/messaging/gcpPubSubQueueHandler'
import { QueueName, QueuePayloadByName } from '../../../platform/messaging/queues'
import { createMockLogger } from '../../setup/mockFactories'

type PublishedMessage = { data: string, topic: string }

const topicExists = new Map<string, boolean>()
const subscriptionExists = new Map<string, boolean>()
const publishedMessages: PublishedMessage[] = []
const subscriptions = new Map<string, FakeSubscription>()
const topics = new Map<string, FakeTopic>()
const lastPubSub: { instance?: FakePubSub } = {}

class FakeMessage {
  public readonly ack = jest.fn()
  public constructor(public readonly data: Buffer, public readonly id = 'msg-1') {}
}

class FakeSubscription extends EventEmitter {
  public close = jest.fn(async () => {})

  public exists = jest.fn(async () => [subscriptionExists.get(this.name) ?? false])

  public constructor(public readonly name: string) {
    super()
  }
}

class FakeTopic {
  public createSubscription = jest.fn(async (subscriptionName: string, _options: unknown) => {
    const existing = subscriptions.get(subscriptionName) ?? new FakeSubscription(subscriptionName)
    subscriptions.set(subscriptionName, existing)
    subscriptionExists.set(subscriptionName, true)
    return [existing]
  })

  public exists = jest.fn(async () => [topicExists.get(this.name) ?? false])

  public publishMessage = jest.fn(async ({ data }: { data: Buffer }) => {
    publishedMessages.push({ data: data.toString(), topic: this.name })
    return 'msg-id'
  })

  public constructor(public readonly name: string) {}
}

class FakePubSub {
  public createTopic = jest.fn(async (name: string) => {
    const topic = new FakeTopic(name)
    topics.set(name, topic)
    topicExists.set(name, true)
    return [topic]
  })

  public subscription(name: string): FakeSubscription {
    const existing = subscriptions.get(name)
    if (existing) return existing
    const subscription = new FakeSubscription(name)
    subscriptions.set(name, subscription)
    return subscription
  }

  public topic(name: string): FakeTopic {
    const existing = topics.get(name)
    if (existing) return existing
    const topic = new FakeTopic(name)
    topics.set(name, topic)
    return topic
  }
}

jest.mock('@google-cloud/pubsub', () => ({
  Message: class {},
  PubSub: jest.fn(() => {
    const instance = new FakePubSub()
    lastPubSub.instance = instance
    return instance
  }),
  Subscription: class {},
}))

const logger = createMockLogger()
const secretManager = {
  getSecret: jest.fn(async () => 'project'),
}
const config = {
  pubSub: {
    ackDeadlineSeconds: 10,
    subscriptionSuffix: '-test',
  },
} as unknown as RuntimeConfiguration

const createHandler = (): GCPPubSubQueueHandler =>
  new GCPPubSubQueueHandler(secretManager as never, logger, config)

const createPaymentSentPayload = (): QueuePayloadByName[QueueName.PAYMENT_SENT] => ({
  amount: 1,
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  paymentMethod: 'PIX',
  targetCurrency: TargetCurrency.BRL,
  transactionId: '00000000-0000-0000-0000-000000000000',
})

beforeEach(() => {
  topicExists.clear()
  subscriptionExists.clear()
  subscriptions.clear()
  topics.clear()
  publishedMessages.length = 0
  jest.clearAllMocks()
})

describe('GCPPubSubQueueHandler dead-letter handling', () => {
  it('skips dead-letter reposts when already on DLQ', async () => {
    const handler = createHandler()
    const postMessage = jest.fn()
    ;(handler as unknown as { postMessage: typeof postMessage }).postMessage = postMessage

    await (handler as unknown as { sendToDeadLetter: GCPPubSubQueueHandler['sendToDeadLetter'] }).sendToDeadLetter(
      QueueName.DEAD_LETTER,
      { payload: true },
      'parse_failed',
    )

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('publishes to DLQ with normalized error details', async () => {
    const handler = createHandler()
    const postMessage = jest.fn()
    ;(handler as unknown as { postMessage: typeof postMessage }).postMessage = postMessage

    await (handler as unknown as { sendToDeadLetter: GCPPubSubQueueHandler['sendToDeadLetter'] }).sendToDeadLetter(
      QueueName.PAYMENT_SENT,
      { payload: true },
      'handler_failed',
      new Error('boom'),
    )

    expect(postMessage).toHaveBeenCalledWith(
      QueueName.DEAD_LETTER,
      expect.objectContaining({
        error: 'boom',
        originalQueue: QueueName.PAYMENT_SENT,
        payload: { payload: true },
        reason: 'handler_failed',
      }),
    )
  })
})

describe('GCPPubSubQueueHandler Pub/Sub integration', () => {
  it('creates topics and publishes messages with ensured client', async () => {
    const handler = createHandler()
    const message = {
      error: undefined,
      originalQueue: QueueName.PAYMENT_SENT,
      payload: { example: true },
      reason: 'parse_failed',
    }

    await handler.postMessage(QueueName.DEAD_LETTER, message)

    expect(secretManager.getSecret).toHaveBeenCalledWith('GCP_PROJECT_ID')
    expect(lastPubSub.instance?.createTopic).toHaveBeenCalledWith(QueueName.DEAD_LETTER)
    expect(publishedMessages).toHaveLength(1)
    expect(JSON.parse(publishedMessages[0].data)).toEqual(message)
  })

  it('subscribes to queues, validates payloads, and acks on success', async () => {
    topicExists.set(QueueName.PAYMENT_SENT, true)
    const handler = createHandler()
    const callback = jest.fn()
    await handler.subscribeToQueue(QueueName.PAYMENT_SENT, callback)

    const subscription = subscriptions.get(`${QueueName.PAYMENT_SENT}${config.pubSub.subscriptionSuffix}`)
    expect(subscription).toBeDefined()
    const topic = topics.get(QueueName.PAYMENT_SENT)
    expect(topic?.createSubscription).toHaveBeenCalledWith(
      `${QueueName.PAYMENT_SENT}${config.pubSub.subscriptionSuffix}`,
      { ackDeadlineSeconds: config.pubSub.ackDeadlineSeconds },
    )

    const payload = createPaymentSentPayload()
    const message = new FakeMessage(Buffer.from(JSON.stringify(payload)), 'msg-success')
    subscription?.emit('message', message)
    await new Promise(resolve => setImmediate(resolve))

    expect(callback).toHaveBeenCalledWith(payload)
    expect(message.ack).toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(0)
  })

  it('sends parse failures to the dead-letter queue and still acks', async () => {
    const handler = createHandler()
    await handler.subscribeToQueue(QueueName.PAYMENT_SENT, async () => {})

    const subscription = subscriptions.get(`${QueueName.PAYMENT_SENT}${config.pubSub.subscriptionSuffix}`)
    const message = new FakeMessage(Buffer.from('{not-json'), 'msg-parse')
    subscription?.emit('message', message)
    await new Promise(resolve => setImmediate(resolve))

    expect(message.ack).toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(1)
    expect(publishedMessages[0].topic).toBe(QueueName.DEAD_LETTER)
    expect(JSON.parse(publishedMessages[0].data)).toMatchObject({
      originalQueue: QueueName.PAYMENT_SENT,
      reason: 'parse_failed',
    })
  })

  it('captures handler errors and posts normalized failures to DLQ', async () => {
    topicExists.set(QueueName.PAYMENT_SENT, true)
    const handler = createHandler()
    const failingCallback = jest.fn(() => {
      throw 'handler boom'
    })
    await handler.subscribeToQueue(QueueName.PAYMENT_SENT, failingCallback)

    const subscription = subscriptions.get(`${QueueName.PAYMENT_SENT}${config.pubSub.subscriptionSuffix}`)
    const payload = createPaymentSentPayload()
    const message = new FakeMessage(Buffer.from(JSON.stringify(payload)), 'msg-failure')
    subscription?.emit('message', message)
    await new Promise(resolve => setImmediate(resolve))

    expect(failingCallback).toHaveBeenCalled()
    expect(message.ack).toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(1)
    expect(JSON.parse(publishedMessages[0].data)).toMatchObject({
      error: 'handler boom',
      originalQueue: QueueName.PAYMENT_SENT,
      payload,
      reason: 'handler_failed',
    })
  })

  it('closes subscriptions when asked', async () => {
    const handler = createHandler()
    await handler.subscribeToQueue(QueueName.PAYMENT_SENT, async () => {})
    await handler.subscribeToQueue(QueueName.DEAD_LETTER, async () => {})

    const subNames = [
      `${QueueName.PAYMENT_SENT}${config.pubSub.subscriptionSuffix}`,
      `${QueueName.DEAD_LETTER}${config.pubSub.subscriptionSuffix}`,
    ]
    await handler.closeAllSubscriptions?.()

    for (const name of subNames) {
      const subscription = subscriptions.get(name)
      expect(subscription?.close).toHaveBeenCalled()
    }
  })
})
