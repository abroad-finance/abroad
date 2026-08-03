import { TargetCurrency } from '@prisma/client'

import { QueueName } from '../../../platform/messaging/queues'
import { OutboxDeliveryError } from '../../../platform/outbox/OutboxDeliveryHandler'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { OutboxRecord } from '../../../platform/outbox/OutboxRepository'

describe('OutboxDispatcher', () => {
  const baseRecord: OutboxRecord = {
    attempts: 0,
    availableAt: new Date(),
    createdAt: new Date(),
    id: 'rec-1',
    idempotencyKey: null,
    initiatedByPortalUserId: null,
    lastAttemptDurationMs: null,
    lastError: null,
    lastHttpStatus: null,
    maxAttempts: 5,
    partnerId: null,
    payload: { kind: 'slack', message: 'hello' },
    sourceOutboxEventId: null,
    status: 'PENDING',
    transactionId: null,
    type: 'slack',
    updatedAt: new Date(),
    webhookCredentialMode: null,
    webhookEvent: null,
    webhookPurpose: null,
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
    const webhookNotifier = {
      notifyWebhook: jest.fn(async () => ({ durationMs: 10, httpStatus: 204 })),
    }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const deliveryHandlerRegistry = { deliver: jest.fn(async () => undefined) }
    const dispatcher = new OutboxDispatcher(
      repository as never,
      webhookNotifier as never,
      slackNotifier as never,
      queueHandler as never,
      deliveryHandlerRegistry as never,
      logger as never,
    )
    return {
      deliveryHandlerRegistry,
      dispatcher,
      logger,
      queueHandler,
      repository,
      slackNotifier,
      webhookNotifier,
    }
  }

  it('delivers slack messages immediately', async () => {
    const { dispatcher, repository, slackNotifier } = buildMocks()
    await dispatcher.enqueueSlack('hello', 'test')
    expect(repository.create).toHaveBeenCalledWith('slack', { kind: 'slack', message: 'hello' }, expect.any(Date), undefined, undefined)
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith('hello')
    expect(repository.markDelivered).toHaveBeenCalledWith(baseRecord.id, undefined, undefined)
  })

  it('delivers webhook payloads', async () => {
    const { dispatcher, repository, webhookNotifier } = buildMocks()
    await dispatcher.enqueueWebhook('https://example.com', { data: { ok: true }, event: 'TRANSACTION_CREATED' as never }, 'ctx')
    expect(repository.create).toHaveBeenCalledWith('webhook', {
      kind: 'webhook',
      payload: { data: { ok: true }, event: 'TRANSACTION_CREATED' },
      target: 'https://example.com',
    }, expect.any(Date), undefined, { webhookEvent: 'TRANSACTION_CREATED' })
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledWith('https://example.com', {
      data: { ok: true },
      event: 'TRANSACTION_CREATED',
    }, { credentialMode: null, partnerId: null })
    expect(repository.markDelivered).toHaveBeenCalledWith(
      baseRecord.id,
      undefined,
      { durationMs: 10, httpStatus: 204 },
    )
  })

  it('defers delivery when instructed', async () => {
    const { dispatcher, repository, slackNotifier } = buildMocks()
    await dispatcher.enqueueSlack('queued', 'ctx', { deliverNow: false })
    expect(repository.create).toHaveBeenCalledWith('slack', { kind: 'slack', message: 'queued' }, expect.any(Date), undefined, undefined)
    expect(slackNotifier.sendMessage).not.toHaveBeenCalled()
  })

  it('delivers queue messages via queue handler', async () => {
    const { dispatcher, queueHandler, repository } = buildMocks()
    const payload = {
      amount: 1,
      currency: TargetCurrency.BRL,
      externalId: 'ext-00000000',
      provider: 'transfero' as const,
      status: 'SETTLED',
    }
    await dispatcher.enqueueQueue(QueueName.PAYMENT_STATUS_UPDATED, payload, 'ctx')
    expect(repository.create).toHaveBeenCalledWith(
      'queue',
      { kind: 'queue', payload, queueName: QueueName.PAYMENT_STATUS_UPDATED },
      expect.any(Date),
      undefined,
      undefined,
    )
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.PAYMENT_STATUS_UPDATED, payload)
  })

  it('persists and routes custom PII-free delivery payloads', async () => {
    const { deliveryHandlerRegistry, dispatcher, repository } = buildMocks()

    await dispatcher.enqueueCustom(
      'partner-portal-verification-email',
      { tokenId: '33333333-3333-4333-8333-333333333333' },
      'signup-email',
    )

    expect(repository.create).toHaveBeenCalledWith(
      'partner-portal-verification-email',
      {
        kind: 'partner-portal-verification-email',
        tokenId: '33333333-3333-4333-8333-333333333333',
      },
      expect.any(Date),
      undefined,
      undefined,
    )
    expect(deliveryHandlerRegistry.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'partner-portal-verification-email' }),
    )
  })

  it('fails a non-retryable custom delivery without rescheduling it', async () => {
    const { deliveryHandlerRegistry, dispatcher, repository } = buildMocks()
    const record: OutboxRecord = {
      ...baseRecord,
      payload: {
        kind: 'partner-portal-verification-email',
        tokenId: '33333333-3333-4333-8333-333333333333',
      },
      type: 'partner-portal-verification-email',
    }
    deliveryHandlerRegistry.deliver.mockRejectedValueOnce(
      new OutboxDeliveryError('invalid durable email job', false),
    )

    await dispatcher.deliver(record, 'signup-email')

    expect(repository.markFailed).toHaveBeenCalledWith(
      record.id,
      expect.any(OutboxDeliveryError),
      undefined,
      undefined,
    )
    expect(repository.reschedule).not.toHaveBeenCalled()
  })

  it('publishes a dead letter without posting an operational Slack message when delivery fails permanently', async () => {
    const { dispatcher, queueHandler, repository, slackNotifier } = buildMocks()
    const failingRecord: OutboxRecord = {
      ...baseRecord,
      attempts: 4,
      payload: { kind: 'queue', payload: { foo: 'bar' }, queueName: QueueName.USER_NOTIFICATION },
      type: 'queue',
    }
    queueHandler.postMessage.mockRejectedValueOnce(new Error('network down'))

    await dispatcher.deliver(failingRecord, 'ctx')

    expect(repository.markFailed).toHaveBeenCalledWith(
      failingRecord.id,
      expect.any(Error),
      undefined,
      undefined,
    )
    expect(slackNotifier.sendMessage).not.toHaveBeenCalled()
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

  it('reschedules a failed webhook instead of marking it delivered', async () => {
    const { dispatcher, repository, webhookNotifier } = buildMocks()
    const deliveryError = new Error('Webhook delivery failed with HTTP 401')
    webhookNotifier.notifyWebhook.mockRejectedValueOnce(deliveryError)
    const record: OutboxRecord = {
      ...baseRecord,
      payload: {
        kind: 'webhook',
        payload: {
          data: { status: 'PAYMENT_COMPLETED' },
          event: 'transaction.updated',
        },
        target: 'https://partner.example/webhook',
      },
      type: 'webhook',
    }

    await dispatcher.deliver(record, 'webhook')

    expect(repository.reschedule).toHaveBeenCalledWith(
      record.id,
      expect.any(Date),
      deliveryError,
      undefined,
      undefined,
    )
    expect(repository.markDelivered).not.toHaveBeenCalled()
  })

  it('logs a warning when dead-letter publishing fails on permanent errors', async () => {
    const { dispatcher, logger, queueHandler, repository, slackNotifier } = buildMocks()
    const permanentFailure = new Error('primary failure')
    queueHandler.postMessage
      .mockRejectedValueOnce(permanentFailure)
      .mockRejectedValueOnce(new Error('dlq down'))

    const record: OutboxRecord = {
      ...baseRecord,
      attempts: 5,
      payload: { kind: 'queue', payload: { foo: 'bar' }, queueName: QueueName.USER_NOTIFICATION },
      type: 'queue',
    }
    await dispatcher.deliver(record, 'ctx')

    expect(repository.markFailed).toHaveBeenCalledWith(
      record.id,
      permanentFailure,
      undefined,
      undefined,
    )
    expect(slackNotifier.sendMessage).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to publish dead-letter for outbox delivery failure'), expect.any(Error))
  })

  it('skips enqueueing when the payload is empty or target missing', async () => {
    const { dispatcher, repository } = buildMocks()
    await dispatcher.enqueueSlack('   ', 'ctx')
    await dispatcher.enqueueWebhook(null, { data: { value: 1 }, event: 'TRANSACTION_UPDATED' as never }, 'ctx')

    expect(repository.create).not.toHaveBeenCalled()
  })
})
