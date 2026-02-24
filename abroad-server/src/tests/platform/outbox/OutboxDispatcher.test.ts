import { TargetCurrency } from '@prisma/client'

import { QueueName } from '../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { OutboxRecord } from '../../../platform/outbox/OutboxRepository'

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
      create: jest.fn(async (type: OutboxRecord['type'], payload: unknown) => ({
        ...baseRecord,
        payload: payload as OutboxRecord['payload'],
        type,
      })),
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
      currency: TargetCurrency.BRL,
      externalId: 'ext-00000000',
      provider: 'transfero' as const,
      status: 'processed',
    }
    await dispatcher.enqueueQueue(QueueName.PAYMENT_STATUS_UPDATED, payload, 'ctx')
    expect(repository.create).toHaveBeenCalledWith(
      'queue',
      { kind: 'queue', payload, queueName: QueueName.PAYMENT_STATUS_UPDATED },
      expect.any(Date),
      undefined,
    )
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.PAYMENT_STATUS_UPDATED, payload)
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
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.DEAD_LETTER, expect.objectContaining({
      error: 'network down',
      originalQueue: 'outbox',
      reason: 'delivery_failed',
    }))
  })

  it('reschedules delivery with backoff on transient failures', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    try {
      const { dispatcher, queueHandler, repository } = buildMocks()
      const transientFailure = new Error('transient')
      queueHandler.postMessage.mockRejectedValueOnce(transientFailure)

      const record: OutboxRecord = {
        ...baseRecord,
        attempts: 0,
        payload: { kind: 'queue', payload: { foo: 'bar' }, queueName: QueueName.USER_NOTIFICATION },
        type: 'queue',
      }
      await dispatcher.deliver(record, 'ctx')

      expect(repository.reschedule).toHaveBeenCalledTimes(1)
      const rescheduleCall = repository.reschedule.mock.calls[0]
      if (!rescheduleCall) {
        throw new Error('reschedule was not invoked')
      }
      const [rescheduledId, nextAttempt, error] = rescheduleCall as unknown as [string, Date, Error]
      expect(rescheduledId).toBe(record.id)
      expect(error).toBe(transientFailure)
      expect(nextAttempt.toISOString()).toBe('2024-01-01T00:00:05.000Z')
    }
    finally {
      jest.useRealTimers()
    }
  })

  it('logs warnings when slack or dead-letter publishing fails on permanent errors', async () => {
    const { dispatcher, logger, queueHandler, repository, slackNotifier } = buildMocks()
    const permanentFailure = new Error('primary failure')
    queueHandler.postMessage
      .mockRejectedValueOnce(permanentFailure)
      .mockRejectedValueOnce(new Error('dlq down'))
    slackNotifier.sendMessage.mockRejectedValueOnce(new Error('slack down'))

    const record: OutboxRecord = {
      ...baseRecord,
      attempts: 5,
      payload: { kind: 'queue', payload: { foo: 'bar' }, queueName: QueueName.USER_NOTIFICATION },
      type: 'queue',
    }
    await dispatcher.deliver(record, 'ctx')

    expect(repository.markFailed).toHaveBeenCalledWith(record.id, permanentFailure, undefined)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to notify Slack about permanent failure'), expect.any(Error))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to publish dead-letter for outbox delivery failure'), expect.any(Error))
  })

  it('skips enqueueing when the payload is empty or target missing', async () => {
    const { dispatcher, repository } = buildMocks()
    await dispatcher.enqueueSlack('   ', 'ctx')
    await dispatcher.enqueueWebhook(null, { data: { value: 1 }, event: 'TRANSACTION_UPDATED' as never }, 'ctx')

    expect(repository.create).not.toHaveBeenCalled()
  })
})
