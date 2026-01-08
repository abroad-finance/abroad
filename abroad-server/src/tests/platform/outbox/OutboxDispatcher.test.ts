import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import { QueueName } from '../../../src/platform/messaging/queues'
import { OutboxDispatcher } from '../../../src/platform/outbox/OutboxDispatcher'
import { OutboxRecord } from '../../../src/platform/outbox/OutboxRepository'

describe('OutboxDispatcher', () => {
  const baseRecord: OutboxRecord = {
    attempts: 0,
    availableAt: new Date(),
    createdAt: new Date(),
    id: 'rec-1',
    lastError: null,
    payload: { kind: 'slack', message: 'hello' },
    status: 'PENDING',
    type: 'slack',
    updatedAt: new Date(),
  }

  const buildMocks = () => {
    const repository = {
      create: jest.fn(async () => baseRecord),
      markDelivered: jest.fn(async () => {}),
      markFailed: jest.fn(async () => {}),
      nextBatch: jest.fn(async () => [baseRecord]),
      reschedule: jest.fn(async () => {}),
    }
    const slackNotifier = { sendMessage: jest.fn(async () => {}) }
    const queueHandler = { postMessage: jest.fn(async () => {}) }
    const webhookNotifier = { notifyWebhook: jest.fn(async () => {}) }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const dispatcher = new OutboxDispatcher(
      repository as never,
      webhookNotifier as never,
      slackNotifier as never,
      queueHandler as never,
      logger as never,
    )
    return { dispatcher, logger, queueHandler, repository, slackNotifier, webhookNotifier }
  }

  it('delivers slack messages immediately', async () => {
    const { dispatcher, repository, slackNotifier } = buildMocks()
    await dispatcher.enqueueSlack('hello', 'test')
    expect(repository.create).toHaveBeenCalledWith('slack', { kind: 'slack', message: 'hello' }, expect.any(Date), undefined)
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith('hello')
    expect(repository.markDelivered).toHaveBeenCalledWith(baseRecord.id, undefined)
  })

  it('delivers webhook payloads', async () => {
    const { dispatcher, repository, webhookNotifier } = buildMocks()
    await dispatcher.enqueueWebhook('https://example.com', { data: { ok: true }, event: 'TRANSACTION_CREATED' as never }, 'ctx')
    expect(repository.create).toHaveBeenCalledWith('webhook', {
      kind: 'webhook',
      payload: { data: { ok: true }, event: 'TRANSACTION_CREATED' },
      target: 'https://example.com',
    }, expect.any(Date), undefined)
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledWith('https://example.com', {
      data: { ok: true },
      event: 'TRANSACTION_CREATED',
    })
  })

  it('defers delivery when instructed', async () => {
    const { dispatcher, repository, slackNotifier } = buildMocks()
    await dispatcher.enqueueSlack('queued', 'ctx', { deliverNow: false })
    expect(repository.create).toHaveBeenCalledWith('slack', { kind: 'slack', message: 'queued' }, expect.any(Date), undefined)
    expect(slackNotifier.sendMessage).not.toHaveBeenCalled()
  })

  it('delivers queue messages via queue handler', async () => {
    const { dispatcher, queueHandler, repository } = buildMocks()
    const payload = {
      amount: 1,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.PIX,
      targetCurrency: TargetCurrency.BRL,
      transactionId: '00000000-0000-0000-0000-000000000000',
    }
    await dispatcher.enqueueQueue(QueueName.PAYMENT_SENT, payload, 'ctx')
    expect(repository.create).toHaveBeenCalledWith(
      'queue',
      { kind: 'queue', payload, queueName: QueueName.PAYMENT_SENT },
      expect.any(Date),
      undefined,
    )
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.PAYMENT_SENT, payload)
  })

  it('alerts slack when delivery fails permanently', async () => {
    const { dispatcher, queueHandler, repository, slackNotifier } = buildMocks()
    const failingRecord: OutboxRecord = {
      ...baseRecord,
      attempts: 4,
      payload: { kind: 'queue', payload: { foo: 'bar' }, queueName: QueueName.USER_NOTIFICATION },
      type: 'queue',
    }
    queueHandler.postMessage.mockRejectedValueOnce(new Error('network down'))

    await dispatcher.deliver(failingRecord, 'ctx')

    expect(repository.markFailed).toHaveBeenCalledWith(failingRecord.id, expect.any(Error), undefined)
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining(failingRecord.id))
  })
})
