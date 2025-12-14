import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { ISecretManager } from '../../../platform/secrets/ISecretManager'

import { RuntimeConfig } from '../../../app/config/runtime'
import { GCPPubSubQueueHandler } from '../../../platform/messaging/gcpPubSubQueueHandler'
import { QueueName } from '../../../platform/messaging/queues'
import { createMockLogger } from '../../setup/mockFactories'

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
    const handler = new GCPPubSubQueueHandler(secretManager, logger, RuntimeConfig)

    await handler.postMessage(QueueName.PAYMENT_SENT, {
      amount: 100,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.COP,
    })

    expect(secretManager.getSecret).toHaveBeenCalledWith('GCP_PROJECT_ID')
    expect(createTopicMock).toHaveBeenCalledWith(QueueName.PAYMENT_SENT)
    expect(publishMessageMock).toHaveBeenCalledWith({
      data: Buffer.from(JSON.stringify({
        amount: 100,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        paymentMethod: PaymentMethod.NEQUI,
        targetCurrency: TargetCurrency.COP,
      })),
    })
  })

  it('subscribes to a topic and handles incoming messages', async () => {
    subscriptionExistsMock.mockResolvedValueOnce([false])
    const handler = new GCPPubSubQueueHandler(secretManager, logger, RuntimeConfig)
    const callback = jest.fn()
    const queueMessage = {
      addressFrom: 'GABC',
      amount: 42,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: 'tx-hash-1',
      transactionId: '11111111-1111-4111-8111-111111111111',
    }

    onMock.mockImplementation((event: string, listener: (msg: FakeMessage) => void) => {
      if (event === 'message') {
        const msg = new FakeMessage(Buffer.from(JSON.stringify(queueMessage)))
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
    expect(callback).toHaveBeenCalledWith(queueMessage)
    expect(ackMock).toHaveBeenCalled()
  })

  it('acks and drops messages that fail schema validation', async () => {
    const handler = new GCPPubSubQueueHandler(secretManager, logger, RuntimeConfig)
    const callback = jest.fn()

    onMock.mockImplementation((event: string, listener: (msg: FakeMessage) => void) => {
      if (event === 'message') {
        const msg = new FakeMessage(Buffer.from(JSON.stringify({})))
        listener(msg)
      }
      return undefined
    })

    await handler.subscribeToQueue(QueueName.RECEIVED_CRYPTO_TRANSACTION, callback)

    expect(callback).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to validate PubSub message'),
      expect.objectContaining({ context: expect.objectContaining({ queueName: QueueName.RECEIVED_CRYPTO_TRANSACTION }) }),
      expect.objectContaining({ issues: expect.any(Array) }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Dropping message due to parse failure'),
      expect.objectContaining({ context: expect.objectContaining({ queueName: QueueName.RECEIVED_CRYPTO_TRANSACTION }) }),
    )
    expect(ackMock).toHaveBeenCalled()
  })
})
