import { FlowStepType, TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { IExchangeProviderFactory } from '../../../treasury/application/contracts/IExchangeProviderFactory'
import { AmountSource, amountSourceSchema, resolveAmount } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

type BinanceBookTickerResponse = {
  askPrice: string
  bidPrice: string
  symbol: string
}

type BinanceExchangeInfoResponse = {
  symbols: BinanceSymbolInfo[]
}

type BinanceFilter = BinanceLotSizeFilter | BinanceNotionalFilter | {
  [key: string]: boolean | number | string | undefined
  filterType: string
}

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

type BinanceOrderFillLite = {
  commission?: string
  commissionAsset?: string
}

type BinanceOrderPayload = {
  newClientOrderId?: string
  quantity?: number
  quoteOrderQty?: number
  side: 'BUY' | 'SELL'
  symbol: string
  type: 'MARKET'
}

type BinanceOrderResultLite = {
  cummulativeQuoteQty?: string
  executedQty?: string
  fills?: BinanceOrderFillLite[]
  orderId?: number
}

type BinanceSymbolInfo = {
  baseAsset: string
  baseAssetPrecision?: number
  filters: BinanceFilter[]
  quoteAsset: string
  quoteAssetPrecision?: number
  symbol: string
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
  fromAsset: z.string().min(2).optional(),
  provider: z.enum(['binance', 'transfero']),
  side: z.enum(['BUY', 'SELL']).optional(),
  sourceCurrency: z.string().min(1).optional(),
  symbol: z.string().min(3).optional(),
  targetCurrency: z.nativeEnum(TargetCurrency).optional(),
  toAsset: z.string().min(2).optional(),
})

type ExchangeConvertConfig = z.infer<typeof exchangeConvertConfigSchema>

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

    const hasPair = Boolean(config.fromAsset && config.toAsset)
    const hasExplicitSymbol = Boolean(config.symbol && config.side)
    if (!hasPair && !hasExplicitSymbol) {
      return { error: 'Binance conversion requires fromAsset/toAsset or symbol/side', outcome: 'failed' }
    }

    try {
      const [apiKey, apiSecret, apiUrl] = await Promise.all([
        this.secretManager.getSecret(Secrets.BINANCE_API_KEY),
        this.secretManager.getSecret(Secrets.BINANCE_API_SECRET),
        this.secretManager.getSecret(Secrets.BINANCE_API_URL),
      ])

      const client = new MainClient({
        api_key: apiKey,
        api_secret: apiSecret,
        baseUrl: apiUrl,
      })

      const market = await this.resolveBinanceMarket({ apiUrl, config })
      if (!market) {
        return { error: 'No Binance market found for the requested conversion', outcome: 'failed' }
      }

      const { orderPayload } = await this.buildBinanceOrderPayload({
        amount,
        apiUrl,
        side: market.side,
        symbol: market.symbol,
        symbolInfo: market.symbolInfo,
      })

      // Idempotency: a deterministic clientOrderId ties this conversion to a
      // single Binance order across retries. If a prior attempt already placed
      // the order (we re-submit the same id and Binance rejects the duplicate),
      // recover that fill instead of submitting a second, doubling order.
      const clientOrderId = this.buildClientOrderId(runtime.context.transactionId, params.stepOrder)
      if (clientOrderId) {
        orderPayload.newClientOrderId = clientOrderId
      }

      let order: unknown
      try {
        order = await client.submitNewOrder(orderPayload)
      }
      catch (submitError) {
        if (clientOrderId && this.isDuplicateOrderError(submitError)) {
          const existing = await this.fetchFilledOrder(client, market.symbol, clientOrderId)
          if (!existing) {
            throw submitError
          }
          this.logger.warn('Recovered existing Binance order on duplicate submit', { clientOrderId, symbol: market.symbol })
          order = existing
        }
        else {
          throw submitError
        }
      }

      // Downstream hops must act on the asset actually received, net of trading
      // commission — never the input amount (which ignores spread + fees).
      const receivedAmount = this.computeRealizedReceivedAmount({
        order,
        side: market.side,
        symbolInfo: market.symbolInfo,
      })

      if (receivedAmount === undefined) {
        // The order executed but we cannot determine the received amount; fail
        // (operator-retryable). The deterministic clientOrderId makes the retry
        // idempotent — it recovers the existing fill rather than re-submitting.
        return { error: 'Binance conversion filled but realized amount is undeterminable', outcome: 'failed' }
      }

      return {
        outcome: 'succeeded',
        output: {
          amount: receivedAmount,
          orderId: (order as BinanceOrderResultLite)?.orderId ?? null,
          provider: 'binance',
          symbol: market.symbol,
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

      // Convert errors are terminal-but-operator-retryable: there is no signal
      // that resumes a WAITING EXCHANGE_CONVERT (the balance-update channel only
      // wakes AWAIT_EXCHANGE_BALANCE steps), so a 'waiting' convert would strand
      // forever. Recovery is an explicit ops retry, which re-runs execute().
      const message = error instanceof Error ? error.message : 'binance_convert_error'
      this.logger.error('Binance conversion failed', error)
      return { error: message, outcome: 'failed' }
    }
  }

  private async buildBinanceOrderPayload(params: {
    amount: number
    apiUrl: string
    side: 'BUY' | 'SELL'
    symbol: string
    symbolInfo?: BinanceSymbolInfo
  }): Promise<{ adjustedAmount: number, orderPayload: BinanceOrderPayload }> {
    const { amount, apiUrl, side, symbol } = params
    let symbolInfo: BinanceSymbolInfo | undefined = params.symbolInfo
    if (!symbolInfo) {
      try {
        symbolInfo = await this.getSymbolInfo(symbol, apiUrl)
      }
      catch (error) {
        this.logger.warn('Unable to load Binance exchange info; proceeding without filters', {
          error,
          symbol,
        })
      }
    }

    if (!symbolInfo) {
      const orderPayload: BinanceOrderPayload = { quantity: amount, side, symbol, type: 'MARKET' }
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
        quoteOrderQty: this.roundToPrecision(amount, quotePrecision),
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
      quantity: this.roundToPrecision(adjusted, decimals),
      side,
      symbol,
      type: 'MARKET',
    }
    return { adjustedAmount: adjusted, orderPayload }
  }

  private buildBinanceUrl(baseUrl: string, path: string): string {
    const trimmed = baseUrl.replace(/\/$/, '')
    return `${trimmed}${path}`
  }

  /**
   * Deterministic Binance clientOrderId for a conversion: stable across retries
   * of the same flow step so re-running it maps to the SAME order (Binance
   * rejects a duplicate clientOrderId). Alphanumeric only, capped at 36 chars
   * per Binance's clientOrderId limit. Undefined if no transaction id is known.
   */
  private buildClientOrderId(transactionId: string | undefined, stepOrder: number): string | undefined {
    if (!transactionId) {
      return undefined
    }
    const compact = transactionId.replace(/[^a-zA-Z0-9]/g, '')
    return `${compact}${stepOrder}`.slice(0, 36)
  }

  /**
   * The amount of the RECEIVED asset actually credited by a filled market order,
   * net of trading commission charged in that asset. For BUY the received asset
   * is the base (executedQty); for SELL it is the quote (cummulativeQuoteQty).
   * Falls back to the order's input amount if the fill payload is unavailable.
   */
  private computeRealizedReceivedAmount(params: {
    order: unknown
    side: 'BUY' | 'SELL'
    symbolInfo: BinanceSymbolInfo
  }): number | undefined {
    const { order, side, symbolInfo } = params
    const result = order as BinanceOrderResultLite
    const receivedAsset = (side === 'BUY' ? symbolInfo.baseAsset : symbolInfo.quoteAsset)?.toUpperCase()
    // Received asset = base on BUY (executedQty), quote on SELL (cummulativeQuoteQty).
    // If it cannot be read we return undefined — NEVER the input amount, which is
    // a different asset's denomination and would misdirect the downstream hop.
    const gross = Number(side === 'BUY' ? result?.executedQty : result?.cummulativeQuoteQty)
    if (!Number.isFinite(gross) || gross <= 0) {
      return undefined
    }

    let commission = 0
    const fills = Array.isArray(result?.fills) ? result.fills : []
    for (const fill of fills) {
      if (typeof fill?.commissionAsset === 'string' && fill.commissionAsset.toUpperCase() === receivedAsset) {
        const value = Number(fill.commission)
        if (Number.isFinite(value)) {
          commission += value
        }
      }
    }

    const net = gross - commission
    if (net <= 0) {
      return undefined
    }
    // Floor (never round up) to the received asset's precision: this value is
    // used verbatim as the next hop's withdraw/convert amount, so a float tail
    // must never push it above the balance actually held.
    const rawPrecision = side === 'BUY' ? symbolInfo.baseAssetPrecision : symbolInfo.quoteAssetPrecision
    const precision = typeof rawPrecision === 'number' ? Math.max(0, Math.min(rawPrecision, 8)) : 8
    const scale = 10 ** precision
    const floored = Math.floor(net * scale) / scale
    return floored > 0 ? floored : undefined
  }

  private decimalsFromStep(stepSize: string): number {
    const trimmed = stepSize.trim()
    const dot = trimmed.indexOf('.')
    if (dot < 0) return 0
    return trimmed.slice(dot + 1).replace(/0+$/, '').length
  }

  /**
   * Normalise a Binance error across the two shapes we see: the `binance`
   * client throws a PLAIN OBJECT { code, message, body }, while the raw axios
   * calls (exchangeInfo/bookTicker) throw an AxiosError with response.data.
   * Returns the numeric code and a lowercased, concatenated message text.
   */
  private describeBinanceError(error: unknown): { code: number | undefined, text: string } {
    const e = error as {
      body?: { code?: number, msg?: string }
      code?: number
      message?: string
      response?: { data?: { code?: number, msg?: string } }
    }
    const code = e?.code ?? e?.body?.code ?? e?.response?.data?.code
    const parts = [e?.message, e?.body?.msg, e?.response?.data?.msg, error instanceof Error ? error.message : undefined]
      .filter((part): part is string => typeof part === 'string')
    return { code, text: parts.join(' | ').toLowerCase() }
  }

  /**
   * Fetch a previously-placed order by clientOrderId and, if filled, shape it
   * (with trade commissions) like a fresh order result so the realized amount
   * can be computed. Used to recover idempotently from a duplicate-order submit.
   */
  private async fetchFilledOrder(client: MainClient, symbol: string, clientOrderId: string): Promise<BinanceOrderResultLite | undefined> {
    try {
      const order = await client.getOrder({ origClientOrderId: clientOrderId, symbol }) as {
        cummulativeQuoteQty?: string
        executedQty?: string
        orderId?: number
        status?: string
      }
      // Only a terminal, fully-FILLED order is safe to treat as the final
      // realized amount. A non-terminal PARTIALLY_FILLED order is not settled,
      // so we surface it as unresolved (retryable) rather than under-deliver.
      if (order?.status !== 'FILLED' || typeof order.orderId !== 'number') {
        return undefined
      }

      // Trades are REQUIRED to know the commission: without them we'd return the
      // gross and over-report the received amount, driving an oversized withdraw.
      // If the trade lookup fails it bubbles to the catch below → undefined.
      const trades = await client.getAccountTradeList({ orderId: order.orderId, symbol })
      if (!Array.isArray(trades) || trades.length === 0) {
        return undefined
      }

      return {
        cummulativeQuoteQty: order.cummulativeQuoteQty,
        executedQty: order.executedQty,
        fills: trades.map(trade => ({
          commission: (trade as { commission?: string })?.commission,
          commissionAsset: (trade as { commissionAsset?: string })?.commissionAsset,
        })),
        orderId: order.orderId,
      }
    }
    catch (error) {
      this.logger.warn('Unable to fetch existing Binance order on duplicate submit', { clientOrderId, error, symbol })
      return undefined
    }
  }

  private floorToStep(amount: number, stepSize: string): number {
    const decimals = this.decimalsFromStep(stepSize)
    if (decimals === 0) {
      return Math.floor(amount)
    }
    const scale = 10 ** decimals
    return Math.floor(amount * scale + 1e-8) / scale
  }

  private getLotSizeFilter(filters: BinanceFilter[]): BinanceLotSizeFilter | undefined {
    const market = filters.find(filter => filter.filterType === 'MARKET_LOT_SIZE') as BinanceLotSizeFilter | undefined
    if (market) return market
    return filters.find(filter => filter.filterType === 'LOT_SIZE') as BinanceLotSizeFilter | undefined
  }

  private getNotionalFilter(filters: BinanceFilter[]): BinanceNotionalFilter | undefined {
    const found = filters.find(filter => filter.filterType === 'NOTIONAL' || filter.filterType === 'MIN_NOTIONAL')
    return found as BinanceNotionalFilter | undefined
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

  /** Binance "Duplicate order sent." rejection (same clientOrderId re-submitted). */
  private isDuplicateOrderError(error: unknown): boolean {
    return this.describeBinanceError(error).text.includes('duplicate order')
  }

  /**
   * A DEFINITIVE "symbol not listed" — Binance code -1121, an "Invalid symbol"
   * message, or an empty exchangeInfo result. A bare HTTP 400 (e.g. a proxy/WAF
   * rejection) is NOT treated as not-listed: it propagates so the conversion
   * fails (operator-retryable) instead of being silently skipped as if the pair
   * did not exist.
   */
  private isSymbolNotListedError(error: unknown): boolean {
    const { code, text } = this.describeBinanceError(error)
    return code === -1121
      || text.includes('invalid symbol')
      || text.includes('exchangeinfo missing for symbol')
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  /**
   * Resolve the Binance trading symbol + order side for a conversion.
   * Binance lists each pair in a single direction, so a from/to intent must be
   * probed in both orientations against exchangeInfo: if `from+to` is a real
   * symbol the base is `from` (SELL base for quote); if `to+from` is real the
   * base is `to` (BUY base, spending `from` as the quote). An explicit
   * symbol/side is honoured but still verified — we never submit an order for a
   * symbol Binance does not list.
   */
  private async resolveBinanceMarket(params: {
    apiUrl: string
    config: ExchangeConvertConfig
  }): Promise<undefined | { side: 'BUY' | 'SELL', symbol: string, symbolInfo: BinanceSymbolInfo }> {
    const { apiUrl, config } = params
    const candidates: { expectBase?: string, expectQuote?: string, side: 'BUY' | 'SELL', symbol: string }[] = []

    if (config.fromAsset && config.toAsset) {
      const from = config.fromAsset.toUpperCase()
      const to = config.toAsset.toUpperCase()
      candidates.push({ expectBase: from, expectQuote: to, side: 'SELL', symbol: `${from}${to}` })
      candidates.push({ expectBase: to, expectQuote: from, side: 'BUY', symbol: `${to}${from}` })
    }
    else if (config.symbol && config.side) {
      candidates.push({ side: config.side, symbol: config.symbol.toUpperCase() })
    }

    for (const candidate of candidates) {
      const symbolInfo = await this.tryGetSymbolInfo(candidate.symbol, apiUrl)
      if (!symbolInfo) {
        continue
      }
      // Existence alone is insufficient: confirm the listed base/quote match the
      // intent so a concatenation collision can never drive a wrong-side order.
      if (candidate.expectBase !== undefined) {
        const base = symbolInfo.baseAsset?.toUpperCase()
        const quote = symbolInfo.quoteAsset?.toUpperCase()
        if (base !== candidate.expectBase || quote !== candidate.expectQuote) {
          continue
        }
      }
      return { side: candidate.side, symbol: candidate.symbol, symbolInfo }
    }
    return undefined
  }

  private roundToPrecision(amount: number, decimals: number): number {
    const normalizedDecimals = Math.max(0, Math.min(decimals, 12))
    if (normalizedDecimals === 0) return Math.trunc(amount)
    // Convert through string to clamp floating point tails (e.g., 1.1000000003).
    return Number(amount.toFixed(normalizedDecimals))
  }

  private async tryGetSymbolInfo(symbol: string, apiUrl: string): Promise<BinanceSymbolInfo | undefined> {
    try {
      return await this.getSymbolInfo(symbol, apiUrl)
    }
    catch (error) {
      // Only swallow a definitive "symbol not listed" so we can probe the other
      // orientation. Transient errors (timeout/5xx/rate-limit) must propagate so
      // a funded conversion is retried, not stranded on a doomed assumption.
      if (this.isSymbolNotListedError(error)) {
        return undefined
      }
      throw error
    }
  }
}
