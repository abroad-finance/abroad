import type { ISecretManager } from '../../interfaces/ISecretManager'

import { GCPPubSubQueueHandler } from '../../infrastructure/gcpPubSubQueueHandler'
import { QueueName } from '../../interfaces'
import { createMockLogger } from '../setup/mockFactories'

const publishMessageMock = jest.fn()
const createTopicMock = jest.fn()
const topicExistsMock = jest.fn()
const subscriptionExistsMock = jest.fn()
const createSubscriptionMock = jest.fn()
const ackMock = jest.fn()
const onMock = jest.fn()
const logger = createMockLogger()

class FakeMessage {
  data: Buffer
  constructor(data: Buffer) {
    this.data = data
  }

  ack() {
    ackMock()
  }
}

jest.mock('@google-cloud/pubsub', () => ({
  PubSub: jest.fn(() => ({
    createTopic: createTopicMock,
    subscription: () => ({
      exists: subscriptionExistsMock,
      on: onMock,
    }),
    topic: (name: string) => ({
      createSubscription: createSubscriptionMock,
      exists: topicExistsMock,
      name,
      publishMessage: publishMessageMock,
    }),
  })),
  Subscription: jest.fn(),
}))

describe('GCPPubSubQueueHandler', () => {
  let secretManager: ISecretManager

  beforeEach(() => {
    jest.clearAllMocks()
    topicExistsMock.mockResolvedValue([true])
    subscriptionExistsMock.mockResolvedValue([true])
    secretManager = {
      getSecret: jest.fn(async () => 'proj-1'),
      getSecrets: jest.fn(),
    }
  })

  it('publishes messages to a topic and creates it if missing', async () => {
    topicExistsMock.mockResolvedValueOnce([false])
    const handler = new GCPPubSubQueueHandler(secretManager, logger)

    await handler.postMessage(QueueName.PAYMENT_SENT, { ok: true })

    expect(secretManager.getSecret).toHaveBeenCalledWith('GCP_PROJECT_ID')
    expect(createTopicMock).toHaveBeenCalledWith(QueueName.PAYMENT_SENT)
    expect(publishMessageMock).toHaveBeenCalledWith({ data: Buffer.from(JSON.stringify({ ok: true })) })
  })

  it('subscribes to a topic and handles incoming messages', async () => {
    subscriptionExistsMock.mockResolvedValueOnce([false])
    const handler = new GCPPubSubQueueHandler(secretManager, logger)
    const callback = jest.fn()

    onMock.mockImplementation((event: string, listener: (msg: FakeMessage) => void) => {
      if (event === 'message') {
        const msg = new FakeMessage(Buffer.from(JSON.stringify({ value: 42 })))
        listener(msg)
      }
      return undefined
    })

    await handler.subscribeToQueue(QueueName.RECEIVED_CRYPTO_TRANSACTION, callback)

    expect(createSubscriptionMock).toHaveBeenCalledWith(
      'received-crypto-transaction-subscription',
      expect.objectContaining({ ackDeadlineSeconds: expect.any(Number) }),
    )
    expect(onMock).toHaveBeenCalledWith('message', expect.any(Function))
    expect(callback).toHaveBeenCalledWith({ value: 42 })
    expect(ackMock).toHaveBeenCalled()
  })
})
