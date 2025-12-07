import 'reflect-metadata'
import { WebsocketClient } from 'binance'

import type { ILogger, IQueueHandler } from '../../interfaces'
import type { ISecretManager } from '../../interfaces/ISecretManager'

import { QueueName } from '../../interfaces'
import { BinanceListener } from '../../listeners/binance'

type HandlerMap = Record<string, ((data: unknown) => void)[]>

let handlerMap: HandlerMap = {}

class FakeWebsocketClient {
  public closeAll = jest.fn()
  private handlers: HandlerMap = {}

  public constructor(_config?: unknown) {
    void _config
    handlerMap = this.handlers
  }

  public on(event: string, handler: (payload: unknown) => void) {
    if (!this.handlers[event]) {
      this.handlers[event] = []
    }
    this.handlers[event]!.push(handler)
  }

  public subscribeSpotUserDataStream(): Promise<{ wsKey: string }> {
    return Promise.resolve({ wsKey: 'spot' })
  }
}

jest.mock('binance', () => ({
  WebsocketClient: jest.fn((config: unknown) => new FakeWebsocketClient(config)),
}))

const queueHandler: IQueueHandler = {
  closeAllSubscriptions: jest.fn(),
  postMessage: jest.fn(),
  subscribeToQueue: jest.fn(),
}

const secretManager: ISecretManager = {
  getSecret: jest.fn(),
  getSecrets: jest.fn(),
}

const logger: ILogger = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}

const flushHandlers = (event: string, payload: unknown) => {
  handlerMap[event]?.forEach(fn => fn(payload))
}

describe('BinanceListener', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    handlerMap = {}
    ;(secretManager.getSecret as jest.Mock).mockReset()
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('api-key')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('api-secret')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://api.binance.com')
    ;(secretManager.getSecrets as jest.Mock).mockResolvedValue({})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('starts the listener and reacts to websocket events', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    await listener.start()

    expect(WebsocketClient).toHaveBeenCalledWith({
      api_key: 'api-key',
      api_secret: 'api-secret',
      restOptions: { baseUrl: 'https://api.binance.com' },
      wsUrl: 'wss://api.binance.com',
    })

    flushHandlers('message', [])
    flushHandlers('message', { streamName: 'user', wsKey: 'spot' })
    flushHandlers('open', { wsKey: 'spot' })
    flushHandlers('reconnecting', { wsKey: 'spot' })
    flushHandlers('reconnected', { wsKey: 'spot' })
    flushHandlers('close', { wsKey: 'spot' })
    flushHandlers('response', { isWSAPIResponse: true, wsKey: 'spot' })
    flushHandlers('exception', new Error('boom'))
    flushHandlers('formattedUserDataMessage', {
      balances: [{ asset: 'USDT', free: '1' }],
      eventTime: Date.now(),
      eventType: 'outboundAccountPosition',
    })
    flushHandlers('formattedUserDataMessage', {
      eventTime: Date.now(),
      eventType: 'outboundAccountPosition',
    })
    flushHandlers('formattedUserDataMessage', {
      eventTime: Date.now(),
      eventType: 'somethingElse',
    })

    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.BINANCE_BALANCE_UPDATED, {})
    expect(logger.info).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('throws when secrets are missing', async () => {
    ;(secretManager.getSecret as jest.Mock).mockReset()
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('')
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    await expect(listener.start()).rejects.toThrow('[Binance WS]: Missing API configuration')
  })

  it('stops the listener safely', async () => {
    ;(secretManager.getSecret as jest.Mock).mockReset()
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('api-key')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('api-secret')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://api.binance.com')
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    await listener.start()
    await listener.stop()

    const clientInstance = (WebsocketClient as unknown as jest.Mock).mock.results[0]?.value as FakeWebsocketClient
    expect(clientInstance.closeAll).toHaveBeenCalledWith(true)
  })

  it('subscribes even when websocket client does not return a wsKey', async () => {
    const subscribeSpy = jest.spyOn(FakeWebsocketClient.prototype, 'subscribeSpotUserDataStream')
    subscribeSpy.mockResolvedValueOnce(undefined as unknown as { wsKey: string })
    const listener = new BinanceListener(secretManager, queueHandler, logger)

    await listener.start()

    expect(subscribeSpy).toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('[Binance WS]: Subscribed to spot user data stream')
  })

  it('converts arbitrary urls to websocket equivalents with suffix', () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    const toWsUrl = (listener as unknown as { toWsUrl: (httpUrl: string, pathSuffix?: string) => string }).toWsUrl

    const url = toWsUrl('not-a-url', 'stream')

    expect(url).toBe('not-a-url/stream')
  })

  it('normalizes websocket urls across protocols and suffixes', () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    const toWsUrl = (listener as unknown as { toWsUrl: (httpUrl: string, pathSuffix?: string) => string }).toWsUrl

    expect(toWsUrl('http://api.binance.com/base', 'ws')).toBe('ws://api.binance.com/base/ws')
    expect(toWsUrl('ws://api.binance.com/root/', '/stream')).toBe('ws://api.binance.com/root/stream')
    expect(toWsUrl('not-a-url', '/fallback')).toBe('not-a-url/fallback')
  })

  it('logs and rethrows when startListener fails', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    const startSpy = jest.spyOn(listener as unknown as { startListener: () => Promise<void> }, 'startListener')
    const failure = new Error('initialization failed')
    startSpy.mockRejectedValueOnce(failure)

    await expect(listener.start()).rejects.toThrow(failure)
    expect(logger.error).toHaveBeenCalledWith('[Binance WS]: Failed to start listener', failure)
  })

  it('stops safely when no websocket client has been started', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)

    await listener.stop()

    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Stopping listener'))
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })
})
