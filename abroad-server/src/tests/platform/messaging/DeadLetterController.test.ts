import 'reflect-metadata'

import { DeadLetterController } from '../../../platform/messaging/DeadLetterController'
import { QueueName } from '../../../platform/messaging/queues'
import { DeadLetterMessage } from '../../../platform/messaging/queueSchema'
import { createMockLogger, createMockQueueHandler } from '../../setup/mockFactories'

describe('DeadLetterController', () => {
  it('registers consumer for dead-letter queue', () => {
    const queueHandler = createMockQueueHandler()
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, logger)

    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.DEAD_LETTER,
      expect.any(Function),
      expect.stringContaining('dead-letter'),
    )
  })

  it('logs dead-letter messages without creating transaction-channel notifications', () => {
    const queueHandler = createMockQueueHandler()
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, logger)
    const handler = (controller as unknown as { onDeadLetter: (msg: unknown) => void }).onDeadLetter

    const message: DeadLetterMessage = {
      error: 'boom',
      originalQueue: QueueName.PAYMENT_STATUS_UPDATED,
      payload: { foo: 'bar' },
      reason: 'handler_failed',
    }

    handler.call(controller, message)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Dead-letter message received'),
      expect.objectContaining({
        context: {
          originalQueue: QueueName.PAYMENT_STATUS_UPDATED,
          reason: 'handler_failed',
        },
      }),
      { error: 'boom', payloadPreview: '{"foo":"bar"}' },
    )
  })

  it('logs validation warnings for malformed dead-letter messages', () => {
    const queueHandler = createMockQueueHandler()
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, logger)
    const handler = (controller as unknown as { onDeadLetter: (msg: unknown) => void }).onDeadLetter

    handler.call(controller, { invalid: true })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[DeadLetter] Invalid message received'),
      expect.any(Array),
    )
  })

  it('logs registration failures when subscribing to the dead-letter queue', () => {
    const queueHandler = {
      ...createMockQueueHandler(),
      subscribeToQueue: jest.fn(() => {
        throw new Error('subscription failed')
      }),
    }
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler as never, logger)

    controller.registerConsumers()

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[DeadLetter] Failed to register consumer'), expect.any(Error))
  })

  it('falls back to a placeholder when payload serialization fails', () => {
    const queueHandler = createMockQueueHandler()
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, logger)
    const preview = (controller as unknown as { previewPayload: (payload: unknown) => string }).previewPayload

    expect(preview.call(controller, BigInt(10))).toBe('[unserializable]')
  })

  it('truncates oversized payload previews', () => {
    const queueHandler = createMockQueueHandler()
    const logger = createMockLogger()
    const controller = new DeadLetterController(queueHandler, logger)
    const preview = (controller as unknown as { previewPayload: (payload: unknown) => string }).previewPayload

    const longPayload = 'x'.repeat(600)
    expect(preview.call(controller, longPayload)).toBe(`${'x'.repeat(500)}…`)
  })
})
