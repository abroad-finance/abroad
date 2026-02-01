// src/services/binanceExchangeProvider.ts

import { Wallet } from '@binance/wallet'
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'
import axios from 'axios'
import crypto from 'crypto'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import {
  ExchangeAddressResult,
  ExchangeFailureCode,
  ExchangeOperationResult,
  ExchangeProviderCapability,
  IExchangeProvider,
} from '../../application/contracts/IExchangeProvider'

type BinanceBookTickerResponse = {
  askPrice: string
  askQty: string
  bidPrice: string
  bidQty: string
  symbol: string
}

type BinanceProviderOptions = {
  capability: ExchangeProviderCapability
  loggerScope: string
  supportedSymbols: string[]
}

@injectable()
export class BinanceExchangeProvider implements IExchangeProvider {
  public readonly capability: ExchangeProviderCapability
  public readonly exchangePercentageFee = 0.0085
  private readonly logger: ScopedLogger
  private readonly supportedSymbols: Set<string>

  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    options: BinanceProviderOptions = {
      capability: { blockchain: undefined, targetCurrency: TargetCurrency.COP },
      loggerScope: 'BinanceExchangeProvider',
      supportedSymbols: ['USDCCOP', 'USDTCOP'],
    },
  ) {
    this.capability = options.capability
    this.supportedSymbols = new Set(options.supportedSymbols)
    this.logger = createScopedLogger(baseLogger, { scope: options.loggerScope })
  }

  createMarketOrder: IExchangeProvider['createMarketOrder'] = async (): Promise<ExchangeOperationResult> => ({
    code: 'permanent',
    reason: 'Binance market orders are not supported in this service.',
    success: false,
  })

  /**
   * Gets a deposit address for the specified blockchain and crypto currency
   * @param params Parameters containing blockchain and cryptocurrency information
   * @returns The deposit address and an optional memo for the transaction
   */
  getExchangeAddress: IExchangeProvider['getExchangeAddress'] = async (
    { blockchain, cryptoCurrency },
  ): Promise<ExchangeAddressResult> => {
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
        success: true,
      }
    }
    catch (error) {
      this.logger.error('Error fetching deposit address from Binance', error)
      return this.buildFailure(this.extractFailureCode(error), this.describeError(error))
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

      if (!this.supportedSymbols.has(symbol)) {
        throw new Error(`Unsupported symbol: ${symbol}`)
      }

      this.logger.warn('Falling back to USDT pairs', { sourceCurrency, targetCurrency })

      let sourcePrice: number
      if (sourceCurrency === CryptoCurrency.USDT) {
        sourcePrice = 1
      }
      else {
        const sourceToUSDT = await axios.get<BinanceBookTickerResponse>(
          `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=${sourceCurrency}USDT`,
        )
        sourcePrice = parseFloat(sourceToUSDT.data.askPrice)
      }

      // Get target currency to USDT rate
      const targetToUSDT = await axios.get<BinanceBookTickerResponse>(
        `${BINANCE_API_URL}/api/v3/ticker/bookTicker?symbol=USDT${targetCurrency}`,
      )

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

  private buildFailure(code: ExchangeFailureCode, reason?: string): ExchangeAddressResult {
    return { code, reason, success: false }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    try {
      return JSON.stringify(error)
    }
    catch {
      return 'unknown'
    }
  }

  private extractFailureCode(error: unknown): ExchangeFailureCode {
    const maybeAxios = error as { response?: { status?: number } }
    const status = typeof maybeAxios?.response?.status === 'number' ? maybeAxios.response.status : undefined
    if (status && status >= 400 && status < 500) return 'permanent'
    return 'retriable'
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
      case BlockchainNetwork.CELO:
        return 'CELO'
      case BlockchainNetwork.SOLANA:
        return 'SOL'
      case BlockchainNetwork.STELLAR:
        return 'XLM'
      default:
        throw new Error(`Unsupported blockchain: ${blockchain}`)
    }
  }
}

@injectable()
export class BinanceBrlExchangeProvider extends BinanceExchangeProvider {
  constructor(
    @inject(TYPES.ISecretManager) secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    super(secretManager, baseLogger, {
      capability: { blockchain: BlockchainNetwork.CELO, targetCurrency: TargetCurrency.BRL },
      loggerScope: 'BinanceExchangeProviderBRL',
      supportedSymbols: ['USDCBRL', 'USDTBRL'],
    })
  }
}
