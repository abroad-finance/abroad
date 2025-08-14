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
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })

    // notification when a connection is opened
    wsClient.on('open', (data) => {
      console.log('[Binance WS]: connection opened open:', data.wsKey)
      this.queueHandler.postMessage(QueueName.BINANCE_BALANCE_UPDATED, {})
    })

    // receive formatted events with beautified keys. Any "known" floats stored in strings as parsed as floats.
    wsClient.on('formattedMessage', (data) => {
      // TODO: check if this is a user data event
      if (isWsFormattedUserDataEvent(data)) {
        console.log('[Binance WS]: formatted message received ', JSON.stringify(data, null, 2))
        this.handleSpotUserDataStream(data)
      }
    })

    wsClient.subscribeSpotUserDataStream()
  }
}
