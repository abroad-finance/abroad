import { WebsocketClient } from 'binance'
import { inject } from 'inversify'

import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

export class BinanceListener {
  public constructor(
        @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public startListener = async () => {
    const BINANCE_API_KEY = await this.secretManager.getSecret('BINANCE_API_KEY')
    const BINANCE_API_SECRET = await this.secretManager.getSecret('BINANCE_API_SECRET')
    const BINANCE_API_URL = await this.secretManager.getSecret('BINANCE_API_URL')

    const wsClient = new WebsocketClient(
      {
        api_key: BINANCE_API_KEY,
        api_secret: BINANCE_API_SECRET,
        wsUrl: BINANCE_API_URL,
      },
    )
    // receive raw events
    wsClient.on('message', (data) => {
      console.log('raw message received ', JSON.stringify(data, null, 2))
    })

    // notification when a connection is opened
    wsClient.on('open', (data) => {
      console.log('connection opened open:', data.wsKey, data.ws.target.url)
    })

    // receive formatted events with beautified keys. Any "known" floats stored in strings as parsed as floats.
    wsClient.on('formattedMessage', (data) => {
      console.log('formattedMessage: ', data)
    })

    // read response to command sent via WS stream (e.g LIST_SUBSCRIPTIONS)
    wsClient.on('reply', (data) => {
      console.log('log reply: ', JSON.stringify(data, null, 2))
    })

    // receive notification when a ws connection is reconnecting automatically
    wsClient.on('reconnecting', (data) => {
      console.log('ws automatically reconnecting.... ', data?.wsKey)
    })

    // receive notification that a reconnection completed successfully (e.g use REST to check for missing data)
    wsClient.on('reconnected', (data) => {
      console.log('ws has reconnected ', data?.wsKey)
    })

    // Recommended: receive error events (e.g. first reconnection failed)
    wsClient.on('error', (data) => {
      console.log('ws saw error ', data?.wsKey)
    })

    wsClient.subscribeSpotUserDataStream()
  }
}
