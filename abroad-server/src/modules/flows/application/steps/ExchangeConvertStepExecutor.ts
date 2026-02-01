import { FlowStepType, TargetCurrency } from '@prisma/client'
import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IExchangeProviderFactory } from '../../../treasury/application/contracts/IExchangeProviderFactory'
import { amountSourceSchema, AmountSource, resolveAmount } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

const exchangeConvertConfigSchema = z.object({
  amountSource: amountSourceSchema.optional(),
  provider: z.enum(['binance', 'transfero']),
  side: z.enum(['BUY', 'SELL']).optional(),
  symbol: z.string().min(3).optional(),
  targetCurrency: z.nativeEnum(TargetCurrency).optional(),
  sourceCurrency: z.string().min(1).optional(),
})

@injectable()
export class ExchangeConvertStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.EXCHANGE_CONVERT
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

      const order = await client.submitNewOrder({
        quantity: amount,
        side: config.side,
        symbol: config.symbol,
        type: 'MARKET',
      })

      return {
        outcome: 'succeeded',
        output: {
          amount,
          orderId: order?.orderId ?? null,
          provider: 'binance',
          symbol: config.symbol,
        },
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'binance_convert_error'
      const normalized = message.toLowerCase()
      const isRetryable = normalized.includes('insufficient') || normalized.includes('balance')
      if (isRetryable) {
        return {
          correlation: { provider: 'binance' },
          error: message,
          outcome: 'waiting',
          output: { amount, provider: 'binance', symbol: config.symbol },
        }
      }
      this.logger.error('Binance conversion failed', error)
      return { error: message, outcome: 'failed' }
    }
  }
}
