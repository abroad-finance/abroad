import 'reflect-metadata'

import { DeadLetterController } from '../../../platform/messaging/DeadLetterController'
import { QueueName } from '../../../platform/messaging/queues'
import { DeadLetterMessage } from '../../../platform/messaging/queueSchema'
import { createMockLogger, createMockQueueHandler } from '../../setup/mockFactories'

describe('DeadLetterController', () => {
  it('registers consumer for dead-letter queue', () => {
    const queueHandler = createMockQueueHandler()
    const outboxDispatcher = { enqueueSlack: jest.fn() }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)

    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.DEAD_LETTER,
      expect.any(Function),
      expect.stringContaining('dead-letter'),
    )
  })

  it('logs and alerts when receiving a dead-letter message', async () => {
    const queueHandler = createMockQueueHandler()
    const outboxDispatcher = { enqueueSlack: jest.fn() }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)
    const handler = (controller as unknown as { onDeadLetter: (msg: unknown) => Promise<void> }).onDeadLetter

    const message: DeadLetterMessage = {
      error: 'boom',
      originalQueue: QueueName.PAYMENT_STATUS_UPDATED,
      payload: { foo: 'bar' },
      reason: 'handler_failed',
    }

    await handler.call(controller, message)

    expect(outboxDispatcher.enqueueSlack).toHaveBeenCalledWith(
      expect.stringContaining('[DLQ]'),
      'dead-letter',
      expect.objectContaining({ deliverNow: false }),
    )
    expect(logger.warn).toHaveBeenCalled()
  })

  it('logs validation warnings for malformed dead-letter messages', async () => {
    const queueHandler = createMockQueueHandler()
    const outboxDispatcher = { enqueueSlack: jest.fn() }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)
    const handler = (controller as unknown as { onDeadLetter: (msg: unknown) => Promise<void> }).onDeadLetter

    await handler.call(controller, { invalid: true })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[DeadLetter] Invalid message received'),
      expect.any(Array),
    )
    expect(outboxDispatcher.enqueueSlack).not.toHaveBeenCalled()
  })

  it('logs registration failures when subscribing to the dead-letter queue', () => {
    const queueHandler = {
      ...createMockQueueHandler(),
      subscribeToQueue: jest.fn(() => {
        throw new Error('subscription failed')
      }),
    }
    const outboxDispatcher = { enqueueSlack: jest.fn() }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler as never, outboxDispatcher as never, logger)

    controller.registerConsumers()

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[DeadLetter] Failed to register consumer'), expect.any(Error))
  })

  it('falls back to a placeholder when payload serialization fails', async () => {
    const queueHandler = createMockQueueHandler()
    const outboxDispatcher = { enqueueSlack: jest.fn() }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)
    const preview = (controller as unknown as { previewPayload: (payload: unknown) => string }).previewPayload

    expect(preview.call(controller, BigInt(10))).toBe('[unserializable]')
  })

  it('truncates oversized payload previews', () => {
    const queueHandler = createMockQueueHandler()
    const outboxDispatcher = { enqueueSlack: jest.fn() }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)
    const preview = (controller as unknown as { previewPayload: (payload: unknown) => string }).previewPayload

    const longPayload = 'x'.repeat(600)
    expect(preview.call(controller, longPayload)).toBe(`${'x'.repeat(500)}…`)
  })

  it('logs Slack enqueue failures', async () => {
    const queueHandler = createMockQueueHandler()
    const outboxDispatcher = {
      enqueueSlack: jest.fn(async () => {
        throw new Error('slack unavailable')
      }),
    }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)
    const enqueue = (controller as unknown as { enqueueSlack: (message: DeadLetterMessage) => Promise<void> }).enqueueSlack

    await enqueue.call(controller, {
      error: 'oops',
      originalQueue: QueueName.PAYMENT_STATUS_UPDATED,
      payload: { data: 'sample' },
      reason: 'unroutable',
    })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[DeadLetter] Failed to enqueue Slack alert'),
      expect.any(Error),
    )
  })

  it('uses a neutral body when the dead-letter message lacks an error', async () => {
    const queueHandler = createMockQueueHandler()
    const enqueueSlack = jest.fn()
    const outboxDispatcher = { enqueueSlack }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, outboxDispatcher as never, logger)
    const enqueue = (controller as unknown as { enqueueSlack: (message: DeadLetterMessage) => Promise<void> }).enqueueSlack

    await enqueue.call(controller, {
      error: undefined,
      originalQueue: QueueName.DEAD_LETTER,
      payload: { sample: true },
      reason: 'no_error',
    })

    const [messageBody] = enqueueSlack.mock.calls[0] as [string]
    expect(messageBody).toContain('no error provided')
  })
})
