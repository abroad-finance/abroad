import { FlowStepType, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { IExchangeProviderFactory } from '../../../treasury/application/contracts/IExchangeProviderFactory'
import { IWalletHandlerFactory } from '../../../payments/application/contracts/IWalletHandlerFactory'
import { resolveAmount, amountSourceSchema, AmountSource } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

const exchangeSendConfigSchema = z.object({
  amountSource: amountSourceSchema.optional(),
  provider: z.enum(['binance', 'transfero']).optional(),
})

type ExchangeSendConfig = z.infer<typeof exchangeSendConfigSchema>

@injectable()
export class ExchangeSendStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.EXCHANGE_SEND
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.IWalletHandlerFactory) private readonly walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowExchangeSend' })
  }

  public async execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    const parsed = exchangeSendConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    const config: ExchangeSendConfig = parsed.data
    const runtime = params.runtime

    const amount = resolveAmount(runtime, config.amountSource as AmountSource | undefined, runtime.context.sourceAmount)

    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'Exchange send amount must be positive', outcome: 'failed' }
    }

    try {
      const exchangeProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
        blockchain: runtime.context.blockchain,
        targetCurrency: runtime.context.targetCurrency,
      }) ?? this.exchangeProviderFactory.getExchangeProvider(runtime.context.targetCurrency)

      const addressResult = await exchangeProvider.getExchangeAddress({
        blockchain: runtime.context.blockchain,
        cryptoCurrency: runtime.context.cryptoCurrency,
      })

      if (!addressResult.success) {
        return { error: addressResult.reason ?? 'exchange_address_unavailable', outcome: 'failed' }
      }

      if (config.provider) {
        const expected = this.normalizeProvider(runtime.context.targetCurrency)
        if (expected && config.provider !== expected) {
          return { error: `Exchange provider mismatch: expected ${expected}`, outcome: 'failed' }
        }
      }

      const walletHandler = this.walletHandlerFactory.getWalletHandlerForCapability?.({
        blockchain: runtime.context.blockchain,
      }) ?? this.walletHandlerFactory.getWalletHandler(runtime.context.blockchain)

      const sendResult = await walletHandler.send({
        address: addressResult.address,
        amount,
        cryptoCurrency: runtime.context.cryptoCurrency,
        memo: addressResult.memo,
      })

      if (!sendResult.success) {
        return { error: sendResult.reason ?? 'exchange_send_failed', outcome: 'failed' }
      }

      return {
        outcome: 'succeeded',
        output: {
          address: addressResult.address,
          amount,
          memo: addressResult.memo ?? null,
          transactionId: sendResult.transactionId ?? null,
        },
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'exchange_send_error'
      this.logger.error('Exchange send failed', error)
      return { error: message, outcome: 'failed' }
    }
  }

  private normalizeProvider(targetCurrency: TargetCurrency): null | string {
    if (targetCurrency === TargetCurrency.COP) return 'binance'
    if (targetCurrency === TargetCurrency.BRL) return 'transfero'
    return null
  }
}
