import { Wallet } from '@binance/wallet'
import { FlowStepType, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { IExchangeProviderFactory } from '../../../treasury/application/contracts/IExchangeProviderFactory'
import { AmountSource, amountSourceSchema, resolveAmount } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

const treasuryTransferConfigSchema = z.object({
  amountSource: amountSourceSchema.optional(),
  asset: z.string().min(1),
  destinationProvider: z.enum(['binance', 'transfero']),
  destinationTargetCurrency: z.nativeEnum(TargetCurrency).optional(),
  network: z.string().min(1).optional(),
  sourceProvider: z.enum(['binance']),
})

type TreasuryTransferConfig = z.infer<typeof treasuryTransferConfigSchema>

@injectable()
export class TreasuryTransferStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.TREASURY_TRANSFER
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowTreasuryTransfer' })
  }

  public async execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    const parsed = treasuryTransferConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    const config: TreasuryTransferConfig = parsed.data
    const runtime = params.runtime

    if (config.sourceProvider !== 'binance') {
      return { error: `Unsupported source provider: ${config.sourceProvider}`, outcome: 'failed' }
    }

    const amount = resolveAmount(runtime, config.amountSource as AmountSource | undefined, runtime.context.sourceAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'Transfer amount must be positive', outcome: 'failed' }
    }

    try {
      const destinationCurrency = config.destinationTargetCurrency ?? this.resolveProviderCurrency(config.destinationProvider)
      const destinationProvider = this.exchangeProviderFactory.getExchangeProvider(destinationCurrency)
      const addressResult = await destinationProvider.getExchangeAddress({
        blockchain: runtime.context.blockchain,
        cryptoCurrency: runtime.context.cryptoCurrency,
      })

      if (!addressResult.success) {
        return { error: addressResult.reason ?? 'destination_address_unavailable', outcome: 'failed' }
      }

      const [apiKey, apiSecret, apiUrl] = await Promise.all([
        this.secretManager.getSecret('BINANCE_API_KEY'),
        this.secretManager.getSecret('BINANCE_API_SECRET'),
        this.secretManager.getSecret('BINANCE_API_URL'),
      ])

      const client = new Wallet({
        configurationRestAPI: {
          apiKey,
          apiSecret,
          basePath: apiUrl,
        },
      })

      const response = await client.restAPI.withdraw({
        address: addressResult.address,
        addressTag: addressResult.memo,
        amount,
        coin: config.asset,
        network: config.network,
      })

      const data = await response.data()

      return {
        outcome: 'succeeded',
        output: {
          address: addressResult.address,
          amount,
          destinationProvider: config.destinationProvider,
          memo: addressResult.memo ?? null,
          withdrawId: data?.id ?? null,
        },
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'treasury_transfer_error'
      this.logger.error('Treasury transfer failed', error)
      return { error: message, outcome: 'failed' }
    }
  }

  private resolveProviderCurrency(provider: TreasuryTransferConfig['destinationProvider']): TargetCurrency {
    if (provider === 'binance') return TargetCurrency.COP
    return TargetCurrency.BRL
  }
}
