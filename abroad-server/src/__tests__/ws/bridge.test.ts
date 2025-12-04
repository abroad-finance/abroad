import 'reflect-metadata'

import { QueueName } from '../../interfaces'
import { TYPES } from '../../types'
import { flushAsyncOperations, getLastProcessListener, mockProcessExit } from '../setup/testHarness'

type SubscriptionHandler = (payload: unknown) => void

let subscriptionHandler: SubscriptionHandler | undefined

const queueHandler = {
  closeAllSubscriptions: jest.fn(async () => undefined),
  postMessage: jest.fn(),
  subscribeToQueue: jest.fn(async (_queue: QueueName, handler: SubscriptionHandler) => {
    subscriptionHandler = handler
  }),
}

const webSocketService = {
  emitToUser: jest.fn(),
  start: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined),
}

const getMock = jest.fn()
jest.mock('../../ioc', () => ({
  iocContainer: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

describe('ws bridge', () => {
  beforeEach(() => {
    jest.resetModules()
    subscriptionHandler = undefined
    queueHandler.closeAllSubscriptions.mockClear()
    queueHandler.subscribeToQueue.mockClear()
    queueHandler.postMessage.mockClear()
    webSocketService.emitToUser.mockClear()
    webSocketService.start.mockClear()
    webSocketService.stop.mockClear()
    getMock.mockImplementation((token: unknown) => {
      if (token === TYPES.IWebSocketService) return webSocketService
      if (token === TYPES.IQueueHandler) return queueHandler
      return undefined
    })
  })

  it('returns undefined when asking for an unregistered signal listener', () => {
    expect(getLastProcessListener('SIGUSR2')).toBeUndefined()
  })

  it('routes valid notification messages and parses JSON payloads', async () => {
    await import('../../ws')
    await flushAsyncOperations()

    expect(webSocketService.start).toHaveBeenCalled()
    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.USER_NOTIFICATION,
      expect.any(Function),
      expect.stringContaining(QueueName.USER_NOTIFICATION),
    )
    expect(subscriptionHandler).toBeDefined()

    subscriptionHandler?.({
      id: 'user-1',
      payload: JSON.stringify({ hello: 'world' }),
      type: 'ping',
    })

    expect(webSocketService.emitToUser).toHaveBeenCalledWith('user-1', 'ping', { hello: 'world' })
  })

  it('ignores invalid payloads and handles shutdown signals', async () => {
    const exitSpy = mockProcessExit()

    await import('../../ws')
    await flushAsyncOperations()

    // invalid payload (missing user id) gets dropped
    subscriptionHandler?.({ type: 'ping' })
    expect(webSocketService.emitToUser).not.toHaveBeenCalled()

    // malformed JSON payload is forwarded as raw string
    subscriptionHandler?.({ id: 'user-2', payload: '{', type: 'event' })
    expect(webSocketService.emitToUser).toHaveBeenCalledWith('user-2', 'event', '{')

    const sigintHandler = getLastProcessListener('SIGINT')
    await sigintHandler?.('SIGINT')
    expect(queueHandler.closeAllSubscriptions).toHaveBeenCalled()
    expect(webSocketService.stop).toHaveBeenCalled()
    exitSpy.restore()
  })
})
