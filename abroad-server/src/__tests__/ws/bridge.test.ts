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

const logger = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
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
    queueHandler.closeAllSubscriptions = jest.fn(async () => undefined)
    queueHandler.subscribeToQueue = jest.fn(async (_queue: QueueName, handler: SubscriptionHandler) => {
      subscriptionHandler = handler
    })
    queueHandler.postMessage = jest.fn()
    webSocketService.emitToUser = jest.fn()
    webSocketService.start = jest.fn(async () => undefined)
    webSocketService.stop = jest.fn(async () => undefined)
    logger.error = jest.fn()
    logger.info = jest.fn()
    logger.warn = jest.fn()
    getMock.mockImplementation((token: unknown) => {
      if (token === TYPES.IWebSocketService) return webSocketService
      if (token === TYPES.IQueueHandler) return queueHandler
      if (token === TYPES.ILogger) return logger
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
    expect(logger.warn).toHaveBeenCalledWith('[ws] Invalid notification message received', expect.any(Array))

    // malformed JSON payload is forwarded as raw string
    subscriptionHandler?.({ id: 'user-2', payload: '{', type: 'event' })
    expect(webSocketService.emitToUser).toHaveBeenCalledWith('user-2', 'event', '{')

    const sigintHandler = getLastProcessListener('SIGINT')
    await sigintHandler?.('SIGINT')
    expect(queueHandler.closeAllSubscriptions).toHaveBeenCalled()
    expect(webSocketService.stop).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('[ws] SIGINT received. Shutting down WebSocket bridge...')
    exitSpy.restore()
  })

  it('uses userId when provided and defaults payloads safely', async () => {
    const exitSpy = mockProcessExit()
    queueHandler.closeAllSubscriptions = undefined as unknown as typeof queueHandler.closeAllSubscriptions

    await import('../../ws')
    await flushAsyncOperations()

    subscriptionHandler?.({
      payload: { ok: true },
      type: 'ready',
      userId: 'user-3',
    })
    subscriptionHandler?.({
      type: 'ready',
      userId: 'user-3',
    })

    expect(webSocketService.emitToUser).toHaveBeenCalledWith('user-3', 'ready', { ok: true })
    expect(webSocketService.emitToUser).toHaveBeenCalledWith('user-3', 'ready', {})

    const handler = getLastProcessListener('SIGINT')
    await handler?.('SIGINT')
    expect(webSocketService.stop).toHaveBeenCalled()
    exitSpy.restore()
  })
})
