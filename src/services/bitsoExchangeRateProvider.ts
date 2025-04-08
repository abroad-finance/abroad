// src/services/bitsoExchangeRateProvider.ts
import { CryptoCurrency, TargetCurrency } from '@prisma/client'

import { IExchangeProvider } from '../interfaces/IExchangeProvider'

type TickerPayload = {
  ask: string
  bid: string
  book: string
  change_24: string
  created_at: string
  high: string
  last: string
  low: string
  volume: string
  vwap: string
}

export class BitsoExchangeRateProvider implements IExchangeProvider {
  async getExchangeRate(
    sourceCurrency: CryptoCurrency,
    targetCurrency: TargetCurrency,
  ): Promise<number> {
    const book = `usd_${targetCurrency.toLowerCase()}`
    const url = `https://api-stage.bitso.com/api/v3/ticker?book=${book}`

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      const data = await response.json()

      if (!data.success) {
        throw new Error(`Bitso API error: ${data.error || 'Unknown error'}`)
      }

      const tickerData: TickerPayload = data.payload

      const lastPrice = parseFloat(tickerData.bid)
      if (isNaN(lastPrice)) {
        throw new Error('Invalid ticker data received from Bitso.')
      }

      return 1 / lastPrice
    }
    catch (error) {
      console.error('Error fetching ticker data from Bitso:', error)
      throw error
    }
  }
}
