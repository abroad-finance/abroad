// src/services/binanceExchangeProvider.ts
import { BlockchainNetwork } from '@prisma/client'
import axios from 'axios'
import crypto from 'crypto'
import { inject, injectable } from 'inversify'

import { IExchangeProvider } from '../interfaces/IExchangeProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

type BinanceBookTickerResponse = {
  askPrice: string
  askQty: string
  bidPrice: string
  bidQty: string
  symbol: string
}

type BinanceDepositAddressResponse = {
  address: string
  coin: string
  network?: string
  tag?: string
  url?: string
}

@injectable()
export class BinanceExchangeProvider implements IExchangeProvider {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  /**
   * Gets a deposit address for the specified blockchain and crypto currency
   * @param params Parameters containing blockchain and cryptocurrency information
   * @returns The deposit address and an optional memo for the transaction
   */
  getExchangeAddress: IExchangeProvider['getExchangeAddress'] = async (
    { blockchain, cryptoCurrency },
  ) => {
    try {
      const BINANCE_API_KEY = await this.secretManager.getSecret('BINANCE_API_KEY')
      const BINANCE_API_SECRET = await this.secretManager.getSecret('BINANCE_API_SECRET')
      const BINANCE_API_URL = await this.secretManager.getSecret('BINANCE_API_URL') || 'https://api.binance.com'

      const timestamp = Date.now()
      const network = this.mapBlockchainToNetwork(blockchain)
      const coin = cryptoCurrency

      // Generate a signature for Binance API
      const queryString = `coin=${coin}&timestamp=${timestamp}&network=${network}`
      const signature = this.generateSignature(queryString, BINANCE_API_SECRET)

      const response = await axios.get<BinanceDepositAddressResponse>(
        `${BINANCE_API_URL}/sapi/v1/capital/deposit/address?${queryString}&signature=${signature}`,
        {
          headers: {
            'X-MBX-APIKEY': BINANCE_API_KEY,
          },
        },
      )

      if (!response.data.address) {
        throw new Error('No deposit address returned from Binance')
      }

      return {
        address: response.data.address,
        memo: response.data.tag,
      }
    }
    catch (error) {
      console.error('Error fetching deposit address from Binance:', error)
      throw error
    }
  }

  /**
   * Gets the exchange rate between a source cryptocurrency and target currency
   * @param params Parameters containing source and target currencies
   * @returns The exchange rate as a number
   */
  getExchangeRate: IExchangeProvider['getExchangeRate'] = async (
    { sourceCurrency, targetCurrency },
  ) => {
    try {
      const BINANCE_API_URL = await this.secretManager.getSecret('BINANCE_API_URL') || 'https://api.binance.com'

      // Construct the trading pair symbol
      const symbol = `${sourceCurrency}${targetCurrency}`

      const response = await axios.get<BinanceBookTickerResponse>(
        `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=${symbol}`,
      )

      const price = parseFloat(response.data.askPrice)
      if (isNaN(price)) {
        throw new Error('Invalid price data received from Binance')
      }

      return price
    }
    catch (error) {
      // Log the original error
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn(`Error getting direct exchange rate: ${errorMessage}`)

      // Try the swapped pair before falling back to USDT
      try {
        console.warn(`Trying swapped pair ${targetCurrency}${sourceCurrency}`)
        const BINANCE_API_URL = await this.secretManager.getSecret('BINANCE_API_URL') || 'https://api.binance.com'

        // Try the reverse symbol
        const swappedSymbol = `${targetCurrency}${sourceCurrency}`

        const swappedResponse = await axios.get<BinanceBookTickerResponse>(
          `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=${swappedSymbol}`,
        )

        const swappedPrice = parseFloat(swappedResponse.data.askPrice)
        if (isNaN(swappedPrice)) {
          throw new Error('Invalid price data received from Binance for swapped pair')
        }

        // Return the inverted price for the swapped pair
        return 1 / swappedPrice
      }
      catch (swapError) {
        console.warn(`Swapped pair also failed: ${swapError instanceof Error ? swapError.message : String(swapError)}`)

        // Fallback to USDT pairs if both direct and swapped pairs are not available
        try {
          console.warn(`Falling back to USDT pairs for ${sourceCurrency} to ${targetCurrency}`)

          const BINANCE_API_URL = await this.secretManager.getSecret('BINANCE_API_URL') || 'https://api.binance.com'

          // Get source currency to USDT rate
          const sourceToUSDT = await axios.get<BinanceBookTickerResponse>(
            `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=${sourceCurrency}USDT`,
          )

          // Get target currency to USDT rate
          const targetToUSDT = await axios.get<BinanceBookTickerResponse>(
            `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=${targetCurrency}USDT`,
          )

          const sourcePrice = parseFloat(sourceToUSDT.data.askPrice)
          const targetPrice = parseFloat(targetToUSDT.data.askPrice)

          if (isNaN(sourcePrice) || isNaN(targetPrice)) {
            throw new Error('Invalid price data received from Binance')
          }

          // Calculate the cross rate
          return sourcePrice / targetPrice
        }
        catch (fallbackError) {
          console.error('Error fetching exchange rate from Binance:', fallbackError)
          throw fallbackError
        }
      }
    }
  }

  /**
   * Generates HMAC SHA256 signature for Binance API
   * @param queryString The query string to sign
   * @param apiSecret The Binance API secret
   * @returns The signature as a hexadecimal string
   */
  private generateSignature(queryString: string, apiSecret: string): string {
    return crypto
      .createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex')
  }

  /**
   * Maps blockchain network to Binance network parameter
   * @param blockchain The blockchain network from our system
   * @returns The corresponding Binance network name
   */
  private mapBlockchainToNetwork(blockchain: BlockchainNetwork): string {
    switch (blockchain) {
      case BlockchainNetwork.SOLANA:
        return 'SOL'
      case BlockchainNetwork.STELLAR:
        return 'XLM'
      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`)
    }
  }
}
