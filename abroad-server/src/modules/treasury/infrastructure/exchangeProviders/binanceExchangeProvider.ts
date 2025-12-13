// src/services/binanceExchangeProvider.ts

import { Wallet } from '@binance/wallet'
import { BlockchainNetwork } from '@prisma/client'
import axios from 'axios'
import crypto from 'crypto'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IExchangeProvider } from '../../application/contracts/IExchangeProvider'

type BinanceBookTickerResponse = {
  askPrice: string
  askQty: string
  bidPrice: string
  bidQty: string
  symbol: string
}

const SUPPORTED_SYMBOLS = [
  'USDCCOP',
]

@injectable()
export class BinanceExchangeProvider implements IExchangeProvider {
  public readonly exchangePercentageFee = 0.0085
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'BinanceExchangeProvider' })
  }

  createMarketOrder(): Promise<{ success: boolean }> {
    throw new Error('Method not implemented.')
  }

  /**
   * Gets a deposit address for the specified blockchain and crypto currency
   * @param params Parameters containing blockchain and cryptocurrency information
   * @returns The deposit address and an optional memo for the transaction
   */
  getExchangeAddress: IExchangeProvider['getExchangeAddress'] = async (
    { blockchain, cryptoCurrency },
  ) => {
    try {
      const {
        BINANCE_API_KEY,
        BINANCE_API_SECRET,
        BINANCE_API_URL,
      } = await this.secretManager.getSecrets([
        'BINANCE_API_KEY',
        'BINANCE_API_SECRET',
        'BINANCE_API_URL',
      ])

      const network = this.mapBlockchainToNetwork(blockchain)
      const coin = cryptoCurrency

      const client = new Wallet({
        configurationRestAPI: {
          apiKey: BINANCE_API_KEY,
          apiSecret: BINANCE_API_SECRET,
          basePath: BINANCE_API_URL,
        },
      })

      const response = await client.restAPI.depositAddress({
        coin,
        network,
      })

      const data = await response.data()

      if (!data || !data.address) {
        throw new Error('No deposit address returned from Binance')
      }

      return {
        address: data.address,
        memo: data.tag,
      }
    }
    catch (error) {
      this.logger.error('Error fetching deposit address from Binance', error)
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
      const { BINANCE_API_URL } = await this.secretManager.getSecrets([
        'BINANCE_API_URL',
      ])

      // Construct the trading pair symbol
      const symbol = `${sourceCurrency}${targetCurrency}`

      if (!SUPPORTED_SYMBOLS.includes(symbol)) {
        throw new Error(`Unsupported symbol: ${symbol}`)
      }

      this.logger.warn('Falling back to USDT pairs', { sourceCurrency, targetCurrency })

      // Get source currency to USDT rate
      const sourceToUSDT = await axios.get<BinanceBookTickerResponse>(
        `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=${sourceCurrency}USDT`,
      )

      // Get target currency to USDT rate
      const targetToUSDT = await axios.get<BinanceBookTickerResponse>(
        `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=USDT${targetCurrency}`,
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
      this.logger.error('Error fetching exchange rate from Binance', fallbackError)
      throw fallbackError
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
