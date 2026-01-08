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
      originalQueue: QueueName.PAYMENT_SENT,
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
})
