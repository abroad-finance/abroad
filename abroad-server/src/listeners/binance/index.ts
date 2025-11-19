import { WebsocketClient, WsUserDataEvents } from 'binance'
import { inject } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

export class BinanceListener {
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
    const BINANCE_API_KEY = await this.secretManager.getSecret('BINANCE_API_KEY')
    const BINANCE_API_SECRET = await this.secretManager.getSecret('BINANCE_API_SECRET')
    const BINANCE_API_URL = await this.secretManager.getSecret('BINANCE_API_URL')

    const websocketBinanceUrl = BINANCE_API_URL.replace('http://', 'ws://') + '/stream'

    const wsClient = new WebsocketClient(
      {
        api_key: BINANCE_API_KEY,
        api_secret: BINANCE_API_SECRET,
        restOptions: { baseUrl: BINANCE_API_URL },
        wsUrl: websocketBinanceUrl,
      },
    )

    this.logger.info('[Binance WS]: Websocket client initialized', { baseUrl: BINANCE_API_URL })
    // receive raw events
    wsClient.on('message', (data) => {
      if (Array.isArray(data)) {
        this.logger.info('[Binance WS]: raw message received (array)', {
          items: data.length,
        })
      }
      else {
        this.logger.info('[Binance WS]: raw message received', {
          streamName: data.streamName,
          wsKey: data.wsKey,
        })
      }
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })

    // notification when a connection is opened
    wsClient.on('open', (data) => {
      this.logger.info('[Binance WS]: connection opened', { wsKey: data.wsKey })
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })

    // reconnection lifecycle notifications
    wsClient.on('reconnecting', (data) => {
      this.logger.warn('[Binance WS]: reconnecting', { wsKey: data.wsKey })
    })
    wsClient.on('reconnected', (data) => {
      this.logger.info('[Binance WS]: reconnected', { wsKey: data.wsKey })
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })
    wsClient.on('close', (data) => {
      this.logger.warn('[Binance WS]: connection closed', { wsKey: data.wsKey })
    })
    wsClient.on('response', (data) => {
      this.logger.info('[Binance WS]: ws api response', {
        isWSAPIResponse: data.isWSAPIResponse,
        wsKey: data.wsKey,
      })
    })
    wsClient.on('exception', (data) => {
      this.logger.error('[Binance WS]: websocket exception', data)
    })

    // receive formatted user data events with beautified keys. Any "known" floats stored in strings are parsed as numbers.
    wsClient.on('formattedUserDataMessage', (data: WsUserDataEvents) => {
      this.logger.info('[Binance WS]: formatted user data', {
        eventTime: data.eventTime,
        eventType: data.eventType,
      })
      this.handleSpotUserDataStream(data)
    })

    const connected = await wsClient.subscribeSpotUserDataStream()
    if (connected) {
      this.logger.info('[Binance WS]: Subscribed to spot user data stream', { wsKey: connected.wsKey })
    }
    else {
      this.logger.info('[Binance WS]: Subscribed to spot user data stream')
    }
  }
}
