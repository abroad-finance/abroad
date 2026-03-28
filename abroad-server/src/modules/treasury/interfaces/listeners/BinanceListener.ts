import { WebsocketAPIClient, WsUserDataEvents } from 'binance'
import { inject } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { generateCorrelationId, runWithCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

export class BinanceListener {
  private readonly logger: ScopedLogger
  private wsApiClient?: WebsocketAPIClient
  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'BinanceListener' })
  }

  public start = async () => {
    try {
      this.logger.info('Starting listener')
      await this.startListener()
      this.logger.info('Listener started')
    }
    catch (err: unknown) {
      this.logger.error('Failed to start listener', err)
      throw err
    }
  }

  public stop = async () => {
    try {
      if (this.wsApiClient) {
        this.logger.info('Stopping listener')
        await this.wsApiClient.disconnectAll()
        this.wsApiClient = undefined
      }
    }
    catch (err: unknown) {
      this.logger.error('Failed to stop listener', err)
    }
  }

  private handleSpotUserDataStream = (data: WsUserDataEvents) => {
    const correlationId = generateCorrelationId(String(data.eventTime ?? Date.now()))
    runWithCorrelationId(correlationId, () => {
      if (data.eventType === 'outboundAccountPosition') {
        const balancesCount = 'balances' in data ? data.balances.length : undefined
        this.logger.info('balanceUpdate event received', {
          balances: balancesCount,
          eventTime: data.eventTime,
          eventType: data.eventType,
        })
        void this.queueHandler.postMessage(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'binance' })
      }
      else {
        this.logger.info('user data event received', {
          eventTime: data.eventTime,
          eventType: data.eventType,
        })
      }
    })
  }

  private startListener = async () => {
    const {
      BINANCE_API_KEY,
      BINANCE_API_SECRET,
      BINANCE_API_URL,
    } = await this.secretManager.getSecrets([
      'BINANCE_API_KEY',
      'BINANCE_API_SECRET',
      'BINANCE_API_URL',
    ])

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET || !BINANCE_API_URL) {
      throw new Error('[Binance WS]: Missing API configuration')
    }

    const websocketBinanceUrl = this.toWsUrl(BINANCE_API_URL)

    // Binance deprecated POST /api/v3/userDataStream on 2026-02-20.
    // Use WebsocketAPIClient which subscribes via userDataStream.subscribe.signature (WS API).
    this.wsApiClient = new WebsocketAPIClient({
      api_key: BINANCE_API_KEY,
      api_secret: BINANCE_API_SECRET,
      restOptions: { baseUrl: BINANCE_API_URL },
      wsUrl: websocketBinanceUrl,
    })

    const wsClient = this.wsApiClient.getWSClient()

    this.logger.info('WebSocket API client initialized', { baseUrl: BINANCE_API_URL, wsUrl: websocketBinanceUrl })

    // raw messages: keep lightweight logging only
    wsClient.on('message', (data) => {
      const correlationSeed = typeof data === 'object'
        && data !== null
        && 'eventTime' in data
        && typeof (data as { eventTime?: unknown }).eventTime === 'number'
        ? String((data as { eventTime: number }).eventTime)
        : undefined
      const correlationId = generateCorrelationId(correlationSeed)
      runWithCorrelationId(correlationId, () => {
        if (Array.isArray(data)) {
          this.logger.info('raw message received (array)', { items: data.length })
        }
        else {
          this.logger.info('raw message received', { streamName: data?.streamName, wsKey: data?.wsKey })
        }
        void this.queueHandler.postMessage(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'binance' })
      })
    })

    // connection lifecycle notifications
    wsClient.on('open', (data) => {
      this.logger.info('connection opened', { wsKey: data.wsKey })
      // Trigger an initial balance sync on connect
      void this.queueHandler.postMessage(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'binance' })
    })
    wsClient.on('reconnecting', (data) => {
      this.logger.warn('reconnecting', { wsKey: data.wsKey })
    })
    wsClient.on('reconnected', (data) => {
      this.logger.info('reconnected', { wsKey: data.wsKey })
      // Trigger a balance sync after reconnection
      void this.queueHandler.postMessage(QueueName.EXCHANGE_BALANCE_UPDATED, { provider: 'binance' })
    })
    wsClient.on('close', (data) => {
      this.logger.warn('connection closed', { wsKey: data.wsKey })
    })
    wsClient.on('response', ({ isWSAPIResponse, wsKey }) => {
      this.logger.info('ws api response', { isWSAPIResponse, wsKey })
    })
    wsClient.on('exception', (data) => {
      this.logger.error('websocket exception', data)
    })

    // formatted user data events
    wsClient.on('formattedUserDataMessage', (data: WsUserDataEvents) => {
      this.logger.info('formatted user data', {
        eventTime: data.eventTime,
        eventType: data.eventType,
      })
      this.handleSpotUserDataStream(data)
    })

    await this.wsApiClient.subscribeUserDataStream('mainWSAPI')
    this.logger.info('Subscribed to spot user data stream via WebSocket API')
  }

  private toWsUrl = (httpUrl: string, pathSuffix?: string) => {
    try {
      const u = new URL(httpUrl)
      const protocol = u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol
      const base = `${protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`
      if (!pathSuffix) return base
      const suffix = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`
      return `${base}${suffix}`
    }
    catch {
      // Fallback: naive replace
      if (!pathSuffix) return httpUrl
      return httpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + (pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`)
    }
  }
}
