import { isWsFormattedUserDataEvent, WebsocketClient, WsUserDataEvents } from 'binance'
import { inject } from 'inversify'

import { IQueueHandler, QueueName } from '../../interfaces'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

export class BinanceListener {
  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
  ) { }

  public start = async () => {
    await this.startListener()
  }

  private handleSpotUserDataStream = (data: WsUserDataEvents) => {
    if (data.eventType === 'outboundAccountPosition') {
      console.log('[Binance WS]: balanceUpdate event received: ', data)
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
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
    // receive raw events
    wsClient.on('message', (data) => {
      console.log('[Binance WS]: raw message received ', JSON.stringify(data, null, 2))
    })

    // notification when a connection is opened
    wsClient.on('open', (data) => {
      console.log('[Binance WS]: connection opened open:', data.wsKey)
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })

    // receive formatted events with beautified keys. Any "known" floats stored in strings as parsed as floats.
    wsClient.on('formattedMessage', (data) => {
      if (isWsFormattedUserDataEvent(data)) {
        console.log('[Binance WS]: formatted message received ', JSON.stringify(data, null, 2))
        this.handleSpotUserDataStream(data)
      }
    })

    // read response to command sent via WS stream (e.g LIST_SUBSCRIPTIONS)
    wsClient.on('reply', (data) => {
      console.log('[Binance WS]: log reply: ', JSON.stringify(data, null, 2))
    })

    // receive notification when a ws connection is reconnecting automatically
    wsClient.on('reconnecting', (data) => {
      console.log('[Binance WS]: ws automatically reconnecting.... ', data?.wsKey)
    })

    // receive notification that a reconnection completed successfully (e.g use REST to check for missing data)
    wsClient.on('reconnected', (data) => {
      console.log('[Binance WS]: ws has reconnected ', data?.wsKey)
    })

    // Recommended: receive error events (e.g. first reconnection failed)
    wsClient.on('error', (data) => {
      console.log('[Binance WS]: ws saw error ', data?.wsKey)
    })

    wsClient.subscribeSpotUserDataStream()
  }
}
