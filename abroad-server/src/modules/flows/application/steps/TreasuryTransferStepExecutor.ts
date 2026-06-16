import { Wallet } from '@binance/wallet'
import { CryptoCurrency, FlowStepType, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { IExchangeProviderFactory } from '../../../treasury/application/contracts/IExchangeProviderFactory'
import { mapBlockchainToBinanceNetwork } from '../../../treasury/infrastructure/exchangeProviders/binanceNetworkMap'
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

      // The bridge chain is a property of the destination provider + the asset
      // being moved (e.g. Transfero accepts USDC on Solana) — NOT the original
      // deposit chain (runtime.context.blockchain is the source USDT/CELO leg).
      // Resolve it ONCE and derive BOTH the deposit address and the Binance
      // withdraw network from it, so they can never refer to different chains
      // and route funds to the wrong network.
      const asset = config.asset as CryptoCurrency
      const bridgeNetwork = destinationProvider.getDepositNetwork?.({ cryptoCurrency: asset })
      if (!bridgeNetwork) {
        return { error: `No destination deposit network for ${config.asset}`, outcome: 'failed' }
      }
      const withdrawNetwork = mapBlockchainToBinanceNetwork(bridgeNetwork)
      if (!withdrawNetwork) {
        return { error: `Unsupported withdraw network for ${bridgeNetwork}`, outcome: 'failed' }
      }

      const addressResult = await destinationProvider.getExchangeAddress({
        blockchain: bridgeNetwork,
        cryptoCurrency: asset,
      })

      if (!addressResult.success) {
        return { error: addressResult.reason ?? 'destination_address_unavailable', outcome: 'failed' }
      }

      const [apiKey, apiSecret, apiUrl] = await Promise.all([
        this.secretManager.getSecret(Secrets.BINANCE_API_KEY),
        this.secretManager.getSecret(Secrets.BINANCE_API_SECRET),
        this.secretManager.getSecret(Secrets.BINANCE_API_URL),
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
        addressTag: addressResult.memo ?? undefined,
        amount,
        coin: config.asset,
        network: withdrawNetwork,
      })

      const data = await response.data()

      // Report the amount that will ARRIVE at the destination (withdrawn − the
      // network withdrawal fee on the SAME bridge network) so the next hop
      // converts what was actually credited. Falls back to gross if unknown.
      const withdrawalFee = await this.resolveWithdrawalFee(client, config.asset, withdrawNetwork)
      const creditedAmount = withdrawalFee !== undefined ? Math.max(0, amount - withdrawalFee) : amount

      return {
        outcome: 'succeeded',
        output: {
          address: addressResult.address,
          amount: creditedAmount,
          destinationProvider: config.destinationProvider,
          grossAmount: amount,
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

  /**
   * The Binance withdrawal network fee for a coin/network (deducted from the
   * withdrawal, so the recipient receives amount − fee). Best-effort: returns
   * undefined on any failure so the caller falls back to the gross amount.
   */
  private async resolveWithdrawalFee(client: Wallet, coin: string, network: string | undefined): Promise<number | undefined> {
    try {
      const response = await client.restAPI.allCoinsInformation()
      const data = await response.data()
      const coins = Array.isArray(data) ? data : []
      const match = coins.find(entry => typeof entry?.coin === 'string' && entry.coin.toUpperCase() === coin.toUpperCase())
      const networks = Array.isArray(match?.networkList) ? match.networkList : []
      const networkEntry = network
        ? networks.find(item => item?.network === network)
        : networks.find(item => item?.isDefault) ?? networks[0]
      const fee = Number(networkEntry?.withdrawFee)
      return Number.isFinite(fee) && fee >= 0 ? fee : undefined
    }
    catch (error) {
      this.logger.warn('Unable to resolve Binance withdrawal fee; using gross amount', { coin, error, network })
      return undefined
    }
  }
}
