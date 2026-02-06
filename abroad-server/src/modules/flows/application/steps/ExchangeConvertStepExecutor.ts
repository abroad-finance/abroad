import { FlowStepType, TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IExchangeProviderFactory } from '../../../treasury/application/contracts/IExchangeProviderFactory'
import { AmountSource, amountSourceSchema, resolveAmount } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

type BinanceLotSizeFilter = {
  filterType: 'LOT_SIZE' | 'MARKET_LOT_SIZE'
  maxQty: string
  minQty: string
  stepSize: string
}

type BinanceNotionalFilter = {
  applyToMarket?: boolean
  filterType: 'MIN_NOTIONAL' | 'NOTIONAL'
  minNotional?: string
  notional?: string
}

type BinanceFilter = BinanceLotSizeFilter | BinanceNotionalFilter | {
  filterType: string
  [key: string]: boolean | number | string | undefined
}

type BinanceSymbolInfo = {
  baseAsset: string
  baseAssetPrecision?: number
  filters: BinanceFilter[]
  quoteAsset: string
  quoteAssetPrecision?: number
  symbol: string
}

type BinanceExchangeInfoResponse = {
  symbols: BinanceSymbolInfo[]
}

type BinanceBookTickerResponse = {
  askPrice: string
  bidPrice: string
  symbol: string
}

type BinanceOrderPayload = {
  quoteOrderQty?: string
  quantity?: string
  side: 'BUY' | 'SELL'
  symbol: string
  type: 'MARKET'
}

class BinanceOrderConstraintError extends Error {
  public readonly details: {
    adjusted?: number
    attempt: number
    minNotional?: number
    minQty?: number
    reason: string
    side: 'BUY' | 'SELL'
    stepSize?: string
    symbol: string
  }

  constructor(message: string, details: BinanceOrderConstraintError['details']) {
    super(message)
    this.details = details
    this.name = 'BinanceOrderConstraintError'
  }
}

const exchangeConvertConfigSchema = z.object({
  amountSource: amountSourceSchema.optional(),
  provider: z.enum(['binance', 'transfero']),
  side: z.enum(['BUY', 'SELL']).optional(),
  sourceCurrency: z.string().min(1).optional(),
  symbol: z.string().min(3).optional(),
  targetCurrency: z.nativeEnum(TargetCurrency).optional(),
})

@injectable()
export class ExchangeConvertStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.EXCHANGE_CONVERT
  private readonly exchangeInfoCache = new Map<string, { expiresAt: number, info: BinanceSymbolInfo }>()
  private readonly exchangeInfoCacheTtlMs = 5 * 60_000
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowExchangeConvert' })
  }

  public async execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    const parsed = exchangeConvertConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    const config = parsed.data
    const runtime = params.runtime
    const amount = resolveAmount(runtime, config.amountSource as AmountSource | undefined, runtime.context.sourceAmount)

    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'Conversion amount must be positive', outcome: 'failed' }
    }

    if (config.provider === 'transfero') {
      if (!config.targetCurrency || !config.sourceCurrency) {
        return { error: 'Transfero conversion requires sourceCurrency and targetCurrency', outcome: 'failed' }
      }

      try {
        const exchangeProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
          targetCurrency: config.targetCurrency,
        }) ?? this.exchangeProviderFactory.getExchangeProvider(config.targetCurrency)

        const result = await exchangeProvider.createMarketOrder({
          sourceAmount: amount,
          sourceCurrency: config.sourceCurrency as Parameters<typeof exchangeProvider.createMarketOrder>[0]['sourceCurrency'],
          targetCurrency: config.targetCurrency,
        })

        if (!result.success) {
          return { error: result.reason ?? result.code ?? 'transfero_convert_failed', outcome: 'failed' }
        }

        return {
          outcome: 'succeeded',
          output: { amount, provider: 'transfero', targetCurrency: config.targetCurrency },
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : 'transfero_convert_error'
        this.logger.error('Transfero conversion failed', error)
        return { error: message, outcome: 'failed' }
      }
    }

    if (!config.symbol || !config.side) {
      return { error: 'Binance conversion requires symbol and side', outcome: 'failed' }
    }

    try {
      const [apiKey, apiSecret, apiUrl] = await Promise.all([
        this.secretManager.getSecret('BINANCE_API_KEY'),
        this.secretManager.getSecret('BINANCE_API_SECRET'),
        this.secretManager.getSecret('BINANCE_API_URL'),
      ])

      const client = new MainClient({
        api_key: apiKey,
        api_secret: apiSecret,
        baseUrl: apiUrl,
      })

      const { adjustedAmount, orderPayload } = await this.buildBinanceOrderPayload({
        amount,
        apiUrl,
        side: config.side,
        symbol: config.symbol,
      })

      const order = await client.submitNewOrder(orderPayload)

      return {
        outcome: 'succeeded',
        output: {
          amount: adjustedAmount,
          orderId: order?.orderId ?? null,
          provider: 'binance',
          symbol: config.symbol,
        },
      }
    }
    catch (error) {
      if (error instanceof BinanceOrderConstraintError) {
        this.logger.warn('Binance order blocked by trading filters', {
          details: error.details,
          message: error.message,
        })
        return { error: error.message, outcome: 'failed' }
      }

      const message = error instanceof Error ? error.message : 'binance_convert_error'
      const normalized = message.toLowerCase()
      const isRetryable = normalized.includes('insufficient') || normalized.includes('balance')
      if (isRetryable) {
        return {
          correlation: { provider: 'binance' },
          outcome: 'waiting',
          output: {
            amount,
            provider: 'binance',
            retryReason: message,
            symbol: config.symbol,
          },
        }
      }
      this.logger.error('Binance conversion failed', error)
      return { error: message, outcome: 'failed' }
    }
  }

  private async buildBinanceOrderPayload(params: {
    amount: number
    apiUrl: string
    side: 'BUY' | 'SELL'
    symbol: string
  }): Promise<{ adjustedAmount: number, orderPayload: BinanceOrderPayload }> {
    const { amount, apiUrl, side, symbol } = params
    let symbolInfo: BinanceSymbolInfo | undefined
    try {
      symbolInfo = await this.getSymbolInfo(symbol, apiUrl)
    }
    catch (error) {
      this.logger.warn('Unable to load Binance exchange info; proceeding without filters', {
        error,
        symbol,
      })
    }

    if (!symbolInfo) {
      const orderPayload: BinanceOrderPayload = { side, symbol, type: 'MARKET', quantity: amount.toString() }
      return { adjustedAmount: amount, orderPayload }
    }

    const notionalFilter = this.getNotionalFilter(symbolInfo.filters)
    const minNotional = this.parseNumber(notionalFilter?.minNotional ?? notionalFilter?.notional)
    const quotePrecision = typeof symbolInfo.quoteAssetPrecision === 'number'
      ? symbolInfo.quoteAssetPrecision
      : 8

    if (side === 'BUY') {
      if (minNotional !== undefined && amount < minNotional) {
        throw new BinanceOrderConstraintError('Binance minNotional not met for BUY', {
          attempt: amount,
          minNotional,
          reason: 'min_notional',
          side,
          symbol,
        })
      }

      const orderPayload: BinanceOrderPayload = {
        quoteOrderQty: this.formatAmount(amount, quotePrecision),
        side,
        symbol,
        type: 'MARKET',
      }
      return { adjustedAmount: amount, orderPayload }
    }

    const lotFilter = this.getLotSizeFilter(symbolInfo.filters)
    if (!lotFilter) {
      throw new BinanceOrderConstraintError('Binance LOT_SIZE filter missing', {
        attempt: amount,
        reason: 'lot_size_missing',
        side,
        symbol,
      })
    }

    const adjusted = this.floorToStep(amount, lotFilter.stepSize)
    const minQty = this.parseNumber(lotFilter.minQty)
    if (!Number.isFinite(adjusted) || adjusted <= 0 || (minQty !== undefined && adjusted < minQty)) {
      throw new BinanceOrderConstraintError('Binance quantity below minQty after rounding', {
        adjusted,
        attempt: amount,
        minQty,
        reason: 'min_qty',
        side,
        stepSize: lotFilter.stepSize,
        symbol,
      })
    }

    if (minNotional !== undefined) {
      const price = await this.getReferencePrice(symbol, apiUrl, side)
      const notionalValue = adjusted * price
      if (notionalValue < minNotional) {
        throw new BinanceOrderConstraintError('Binance minNotional not met for SELL', {
          adjusted,
          attempt: amount,
          minNotional,
          reason: 'min_notional',
          side,
          stepSize: lotFilter.stepSize,
          symbol,
        })
      }
    }

    const decimals = this.decimalsFromStep(lotFilter.stepSize)
    const orderPayload: BinanceOrderPayload = {
      quantity: this.formatAmount(adjusted, decimals),
      side,
      symbol,
      type: 'MARKET',
    }
    return { adjustedAmount: adjusted, orderPayload }
  }

  private async getSymbolInfo(symbol: string, apiUrl: string): Promise<BinanceSymbolInfo> {
    const cached = this.exchangeInfoCache.get(symbol)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.info
    }

    const response = await axios.get<BinanceExchangeInfoResponse>(
      this.buildBinanceUrl(apiUrl, '/api/v3/exchangeInfo'),
      { params: { symbol }, timeout: 10_000 },
    )
    const info = response.data.symbols?.[0]
    if (!info) {
      throw new Error(`ExchangeInfo missing for symbol ${symbol}`)
    }
    this.exchangeInfoCache.set(symbol, { expiresAt: Date.now() + this.exchangeInfoCacheTtlMs, info })
    return info
  }

  private async getReferencePrice(symbol: string, apiUrl: string, side: 'BUY' | 'SELL'): Promise<number> {
    const response = await axios.get<BinanceBookTickerResponse>(
      this.buildBinanceUrl(apiUrl, '/api/v3/ticker/bookTicker'),
      { params: { symbol }, timeout: 10_000 },
    )
    const priceString = side === 'BUY' ? response.data.askPrice : response.data.bidPrice
    const price = Number(priceString)
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid book price for ${symbol}`)
    }
    return price
  }

  private getLotSizeFilter(filters: BinanceFilter[]): BinanceLotSizeFilter | undefined {
    const market = filters.find(filter => filter.filterType === 'MARKET_LOT_SIZE') as BinanceLotSizeFilter | undefined
    if (market) return market
    return filters.find(filter => filter.filterType === 'LOT_SIZE') as BinanceLotSizeFilter | undefined
  }

  private getNotionalFilter(filters: BinanceFilter[]): BinanceNotionalFilter | undefined {
    return (
      filters.find(filter => filter.filterType === 'NOTIONAL' || filter.filterType === 'MIN_NOTIONAL')
      as BinanceNotionalFilter | undefined
    )
  }

  private buildBinanceUrl(baseUrl: string, path: string): string {
    const trimmed = baseUrl.replace(/\/$/, '')
    return `${trimmed}${path}`
  }

  private decimalsFromStep(stepSize: string): number {
    const trimmed = stepSize.trim()
    const dot = trimmed.indexOf('.')
    if (dot < 0) return 0
    return trimmed.slice(dot + 1).replace(/0+$/, '').length
  }

  private floorToStep(amount: number, stepSize: string): number {
    const decimals = this.decimalsFromStep(stepSize)
    if (decimals === 0) {
      return Math.floor(amount)
    }
    const scale = 10 ** decimals
    return Math.floor(amount * scale + 1e-8) / scale
  }

  private formatAmount(amount: number, decimals: number): string {
    const normalizedDecimals = Math.max(0, Math.min(decimals, 12))
    return normalizedDecimals === 0 ? Math.trunc(amount).toString() : amount.toFixed(normalizedDecimals)
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
}
