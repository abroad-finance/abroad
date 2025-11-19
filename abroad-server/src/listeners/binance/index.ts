import { WebsocketClient, WsUserDataEvents } from 'binance'
import { inject } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

export class BinanceListener {
  private wsClient?: WebsocketClient
  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) { }

  public start = async () => {
    try {
      this.logger.info('[Binance WS]: Starting listener')
      await this.startListener()
      this.logger.info('[Binance WS]: Listener started')
    }
    catch (err: unknown) {
      this.logger.error('[Binance WS]: Failed to start listener', err)
      throw err
    }
  }

  public stop = async () => {
    try {
      if (this.wsClient) {
        this.logger.info('[Binance WS]: Stopping listener')
        this.wsClient.closeAll(true)
        this.wsClient = undefined
      }
    }
    catch (err: unknown) {
      this.logger.error('[Binance WS]: Failed to stop listener', err)
    }
  }

  private handleSpotUserDataStream = (data: WsUserDataEvents) => {
    if (data.eventType === 'outboundAccountPosition') {
      const balancesCount = 'balances' in data ? data.balances.length : undefined
      this.logger.info('[Binance WS]: balanceUpdate event received', {
        balances: balancesCount,
        eventTime: data.eventTime,
        eventType: data.eventType,
      })
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    }
    else {
      this.logger.info('[Binance WS]: user data event received', {
        eventTime: data.eventTime,
        eventType: data.eventType,
      })
    }
  }

  private startListener = async () => {
    const [BINANCE_API_KEY, BINANCE_API_SECRET, BINANCE_API_URL] = await Promise.all([
      this.secretManager.getSecret('BINANCE_API_KEY'),
      this.secretManager.getSecret('BINANCE_API_SECRET'),
      this.secretManager.getSecret('BINANCE_API_URL'),
    ])

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET || !BINANCE_API_URL) {
      throw new Error('[Binance WS]: Missing API configuration')
    }

    const websocketBinanceUrl = this.toWsUrl(BINANCE_API_URL, '')

    this.wsClient = new WebsocketClient({
      api_key: BINANCE_API_KEY,
      api_secret: BINANCE_API_SECRET,
      restOptions: { baseUrl: BINANCE_API_URL },
      wsUrl: websocketBinanceUrl,
    })

    this.logger.info('[Binance WS]: Websocket client initialized', { baseUrl: BINANCE_API_URL, wsUrl: websocketBinanceUrl })

    // raw messages: keep lightweight logging only
    this.wsClient.on('message', (data) => {
      if (Array.isArray(data)) {
        this.logger.info('[Binance WS]: raw message received (array)', { items: data.length })
      }
      else {
        this.logger.info('[Binance WS]: raw message received', { streamName: data.streamName, wsKey: data.wsKey })
      }
      // Avoid queue spam: do not post for every raw message
    })

    // connection lifecycle notifications
    this.wsClient.on('open', (data) => {
      this.logger.info('[Binance WS]: connection opened', { wsKey: data.wsKey })
      // Trigger an initial balance sync on connect
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })
    this.wsClient.on('reconnecting', (data) => {
      this.logger.warn('[Binance WS]: reconnecting', { wsKey: data.wsKey })
    })
    this.wsClient.on('reconnected', (data) => {
      this.logger.info('[Binance WS]: reconnected', { wsKey: data.wsKey })
      // Trigger a balance sync after reconnection
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })
    this.wsClient.on('close', (data) => {
      this.logger.warn('[Binance WS]: connection closed', { wsKey: data.wsKey })
    })
    this.wsClient.on('response', ({ isWSAPIResponse, wsKey }) => {
      this.logger.info('[Binance WS]: ws api response', { isWSAPIResponse, wsKey })
    })
    this.wsClient.on('exception', (data) => {
      this.logger.error('[Binance WS]: websocket exception', data)
    })

    // formatted user data events
    this.wsClient.on('formattedUserDataMessage', (data: WsUserDataEvents) => {
      this.logger.info('[Binance WS]: formatted user data', {
        eventTime: data.eventTime,
        eventType: data.eventType,
      })
      this.handleSpotUserDataStream(data)
    })

    const connected = await this.wsClient.subscribeSpotUserDataStream()
    if (connected) {
      this.logger.info('[Binance WS]: Subscribed to spot user data stream', { wsKey: connected.wsKey })
    }
    else {
      this.logger.info('[Binance WS]: Subscribed to spot user data stream')
    }
  }

  private toWsUrl = (httpUrl: string, pathSuffix: string) => {
    try {
      const u = new URL(httpUrl)
      const protocol = u.protocol === 'https:' ? 'wss:' : u.protocol === 'http:' ? 'ws:' : u.protocol
      const base = `${protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`
      const suffix = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`
      return `${base}${suffix}`
    }
    catch {
      // Fallback: naive replace
      return httpUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://') + (pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`)
    }
  }
}
