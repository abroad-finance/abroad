import 'reflect-metadata'
import { WebsocketAPIClient } from 'binance'

import type { ILogger } from '../../../../../core/logging/types'
import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { BinanceListener } from '../../../../../modules/treasury/interfaces/listeners/BinanceListener'
import { QueueName } from '../../../../../platform/messaging/queues'
import { createMockQueueHandler } from '../../../../setup/mockFactories'

type HandlerMap = Record<string, ((data: unknown) => void)[]>

let handlerMap: HandlerMap = {}

class FakeWebsocketClient {
  private handlers: HandlerMap = {}

  public constructor() {
    handlerMap = this.handlers
  }

  public on(event: string, handler: (payload: unknown) => void) {
    if (!this.handlers[event]) {
      this.handlers[event] = []
    }
    this.handlers[event]!.push(handler)
  }
}

let webSocketApiConfig: unknown

class FakeWebsocketAPIClient {
  public disconnectAll = jest.fn(() => Promise.resolve())
  public subscribeUserDataStream = jest.fn((wsKey: string) => {
    void wsKey
    return Promise.resolve()
  })

  private readonly wsClient = new FakeWebsocketClient()

  public constructor(config?: unknown) {
    webSocketApiConfig = config
  }

  public getWSClient() {
    return this.wsClient
  }
}

jest.mock('binance', () => ({
  WebsocketAPIClient: jest.fn((config: unknown) => new FakeWebsocketAPIClient(config)),
}))

const queueHandler = createMockQueueHandler()

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
    webSocketApiConfig = undefined
    ;(secretManager.getSecret as jest.Mock).mockReset()
    ;(secretManager.getSecrets as jest.Mock).mockResolvedValue({
      BINANCE_API_KEY: 'api-key',
      BINANCE_API_SECRET: 'api-secret',
      BINANCE_API_URL: 'https://api.binance.com',
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('starts the listener and reacts to websocket events', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    await listener.start()

    expect(WebsocketAPIClient).toHaveBeenCalledWith({
      api_key: 'api-key',
      api_secret: 'api-secret',
      restOptions: { baseUrl: 'https://api.binance.com' },
      wsUrl: 'wss://api.binance.com',
    })
    const client = (WebsocketAPIClient as unknown as jest.Mock).mock.results[0]?.value as FakeWebsocketAPIClient
    expect(client.subscribeUserDataStream).toHaveBeenCalledWith('mainWSAPI')

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

    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'binance', trigger: 'observed' })
    expect(logger.info).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('throws when secrets are missing', async () => {
    ;(secretManager.getSecrets as jest.Mock).mockResolvedValue({
      BINANCE_API_KEY: '',
      BINANCE_API_SECRET: '',
      BINANCE_API_URL: '',
    })
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    await expect(listener.start()).rejects.toThrow('[Binance WS]: Missing API configuration')
  })

  it('stops the listener safely', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    await listener.start()
    await listener.stop()

    const client = (WebsocketAPIClient as unknown as jest.Mock).mock.results[0]?.value as FakeWebsocketAPIClient
    expect(client.disconnectAll).toHaveBeenCalled()
  })

  it('uses only the proxy origin when the REST base URL contains a path', async () => {
    ;(secretManager.getSecrets as jest.Mock).mockResolvedValue({
      BINANCE_API_KEY: 'api-key',
      BINANCE_API_SECRET: 'api-secret',
      BINANCE_API_URL: 'http://proxy.internal:8080/rest/',
    })
    const listener = new BinanceListener(secretManager, queueHandler, logger)

    await listener.start()

    expect(webSocketApiConfig).toEqual(expect.objectContaining({
      restOptions: { baseUrl: 'http://proxy.internal:8080/rest/' },
      wsUrl: 'ws://proxy.internal:8080',
    }))
  })

  it('rejects non-HTTP proxy URLs', async () => {
    ;(secretManager.getSecrets as jest.Mock).mockResolvedValue({
      BINANCE_API_KEY: 'api-key',
      BINANCE_API_SECRET: 'api-secret',
      BINANCE_API_URL: 'ftp://proxy.internal',
    })
    const listener = new BinanceListener(secretManager, queueHandler, logger)

    await expect(listener.start()).rejects.toThrow('[Binance WS]: API URL must use HTTP or HTTPS')
  })

  it('logs and rethrows when startListener fails', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)
    const startSpy = jest.spyOn(listener as unknown as { startListener: () => Promise<void> }, 'startListener')
    const failure = new Error('initialization failed')
    startSpy.mockRejectedValueOnce(failure)

    await expect(listener.start()).rejects.toThrow(failure)
    expect(logger.error).toHaveBeenCalledWith('[BinanceListener] Failed to start listener', failure)
  })

  it('stops safely when no websocket client has been started', async () => {
    const listener = new BinanceListener(secretManager, queueHandler, logger)

    await listener.stop()

    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Stopping listener'))
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })
})
