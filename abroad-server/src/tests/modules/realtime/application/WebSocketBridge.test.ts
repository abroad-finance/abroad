import { WebSocketBridge } from '../../../../modules/realtime/application/WebSocketBridge'
import { QueueName } from '../../../../platform/messaging/queues'
import { IWebSocketService } from '../../../../platform/notifications/IWebSocketService'
import { createMockLogger, createMockQueueHandler } from '../../../setup/mockFactories'

const createMockWebSocketService = (): jest.Mocked<IWebSocketService> => ({
  emitToUser: jest.fn(),
  start: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
})

describe('WebSocketBridge', () => {
  it('subscribes to USER_NOTIFICATION with its ephemeral subscription name', async () => {
    const ws = createMockWebSocketService()
    const queueHandler = createMockQueueHandler()
    const subscriptionName = `${QueueName.USER_NOTIFICATION}-fixed`
    const bridge = new WebSocketBridge(ws, queueHandler, createMockLogger(), { subscriptionName })

    await bridge.start()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.USER_NOTIFICATION,
      expect.any(Function),
      subscriptionName,
    )
  })

  it('deletes (not just closes) its ephemeral subscription on shutdown', async () => {
    const ws = createMockWebSocketService()
    const queueHandler = createMockQueueHandler()
    const bridge = new WebSocketBridge(ws, queueHandler, createMockLogger(), {
      subscriptionName: `${QueueName.USER_NOTIFICATION}-fixed`,
    })

    await bridge.shutdown()

    expect(queueHandler.deleteSubscription).toHaveBeenCalledTimes(1)
    expect(queueHandler.deleteSubscription).toHaveBeenCalledWith(QueueName.USER_NOTIFICATION)
    // Must not fall back to the close-all path (shared with durable consumers)
    // when a targeted delete is available.
    expect(queueHandler.closeAllSubscriptions).not.toHaveBeenCalled()
    expect(ws.stop).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: a second shutdown does not delete the subscription twice', async () => {
    const ws = createMockWebSocketService()
    const queueHandler = createMockQueueHandler()
    const bridge = new WebSocketBridge(ws, queueHandler, createMockLogger(), {
      subscriptionName: `${QueueName.USER_NOTIFICATION}-fixed`,
    })

    await bridge.shutdown()
    await bridge.shutdown()

    expect(queueHandler.deleteSubscription).toHaveBeenCalledTimes(1)
    expect(ws.stop).toHaveBeenCalledTimes(1)
  })

  it('falls back to closeAllSubscriptions when the handler cannot delete', async () => {
    const ws = createMockWebSocketService()
    const queueHandler = createMockQueueHandler({ deleteSubscription: undefined })
    const bridge = new WebSocketBridge(ws, queueHandler, createMockLogger(), {
      subscriptionName: `${QueueName.USER_NOTIFICATION}-fixed`,
    })

    await bridge.shutdown()

    expect(queueHandler.closeAllSubscriptions).toHaveBeenCalledTimes(1)
  })
})
