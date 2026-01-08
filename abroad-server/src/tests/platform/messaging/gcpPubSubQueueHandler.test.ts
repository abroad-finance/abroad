import 'reflect-metadata'

import { RuntimeConfiguration } from '../../../app/config/runtime'
import { GCPPubSubQueueHandler } from '../../../platform/messaging/gcpPubSubQueueHandler'
import { QueueName } from '../../../platform/messaging/queues'
import { createMockLogger } from '../../setup/mockFactories'

describe('GCPPubSubQueueHandler dead-letter handling', () => {
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

  it('skips dead-letter reposts when already on DLQ', async () => {
    const handler = new GCPPubSubQueueHandler(secretManager as never, logger, config)
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
    const handler = new GCPPubSubQueueHandler(secretManager as never, logger, config)
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
