import {
  BlockchainNetwork,
  CryptoCurrency,
  ReplenishLegStatus,
  TargetCurrency,
  TreasuryReplenishStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ICryptoPurchaseService } from './contracts/ICryptoPurchaseService'
import { IExchangeProviderFactory } from './contracts/IExchangeProviderFactory'

/**
 * Transfero settles crypto on Polygon only, so a replenish withdrawal always
 * lands on Abroad's Polygon treasury address. Moving it on to the chain that
 * actually paid the customer is the existing treasury bridge's job — this
 * service stops once the funds are back in Abroad custody.
 */
const ULTRA_WITHDRAWAL_NETWORK = 'POLYGON'

type PendingLeg = {
  asset: CryptoCurrency
  destNetwork: BlockchainNetwork
  fiatAmount: number
  fiatCurrency: TargetCurrency
  id: string
}

type TreasuryReplenishResult = {
  batched: number
  bought: number
  withdrawn: number
}

/**
 * Turns delivered onramps back into hot-wallet float.
 *
 * Every leg here represents a customer who has already been paid, so nothing in
 * this service can fail a customer transaction. What it must not do is buy the
 * same money twice: each stage persists its provider id before the batch is
 * allowed to advance, and a batch that already carries a trade or withdrawal id
 * is reconciled rather than re-executed.
 */
@injectable()
export class TreasuryReplenishService {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ICryptoPurchaseService)
    private readonly purchaseService: ICryptoPurchaseService,
    @inject(TYPES.IExchangeProviderFactory)
    private readonly exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TreasuryReplenish' })
  }

  /**
   * Pools every pending leg for one (asset, destination chain) into a single
   * batch, so one BUY covers many customers instead of paying a desk spread per
   * transaction.
   */
  public async batchPending(): Promise<number> {
    const prisma = await this.dbProvider.getClient()
    const pending = await prisma.treasuryReplenishRequest.findMany({
      orderBy: { createdAt: 'asc' },
      where: { batchId: null, status: ReplenishLegStatus.PENDING },
    })

    if (pending.length === 0) {
      return 0
    }

    const groups = this.groupByCorridor(pending)
    let created = 0

    for (const [, legs] of groups) {
      const first = legs[0]
      const fiatAmount = legs.reduce((total, leg) => total + leg.fiatAmount, 0)
      if (!(fiatAmount > 0)) {
        continue
      }

      await prisma.$transaction(async (tx) => {
        const batch = await tx.treasuryReplenishBatch.create({
          data: {
            asset: first.asset,
            destNetwork: first.destNetwork,
            fiatAmount,
            fiatCurrency: first.fiatCurrency,
            status: TreasuryReplenishStatus.OPEN,
          },
        })
        // Only legs still PENDING and unbatched are claimed, so a concurrent
        // tick cannot enrol the same leg into two batches.
        await tx.treasuryReplenishRequest.updateMany({
          data: { batchId: batch.id, status: ReplenishLegStatus.BATCHED },
          where: {
            batchId: null,
            id: { in: legs.map(leg => leg.id) },
            status: ReplenishLegStatus.PENDING,
          },
        })
      })
      created += 1
    }

    return created
  }

  public async run(): Promise<TreasuryReplenishResult> {
    const batched = await this.batchPending()
    const bought = await this.settleOpenBatches()
    const withdrawn = await this.withdrawBoughtBatches()
    return { batched, bought, withdrawn }
  }

  /**
   * Executes the BUY for every OPEN batch. The trade id is persisted before the
   * batch advances, so an ambiguous confirmation reconciles against the trade
   * rather than opening a second one.
   */
  public async settleOpenBatches(): Promise<number> {
    const prisma = await this.dbProvider.getClient()
    const open = await prisma.treasuryReplenishBatch.findMany({
      where: { status: TreasuryReplenishStatus.OPEN, tradeId: null },
    })

    let settled = 0
    for (const batch of open) {
      const result = await this.purchaseService.buyWithBrl({
        asset: batch.asset,
        brlAmount: batch.fiatAmount,
        operationId: `replenish:${batch.id}`,
      })

      if (!result.success) {
        this.logger.error('Treasury replenish BUY did not settle', {
          batchId: batch.id,
          code: result.code,
          reason: result.reason,
        })
        if (result.code === 'permanent' || result.code === 'validation') {
          await this.failBatch(batch.id, result.reason)
        }
        continue
      }

      await prisma.treasuryReplenishBatch.update({
        data: {
          boughtAmount: result.quantity,
          status: TreasuryReplenishStatus.BOUGHT,
          tradeId: result.tradeId,
        },
        where: { id: batch.id },
      })
      settled += 1
    }

    return settled
  }

  /**
   * Withdraws each bought batch to Abroad custody. A batch without a configured
   * destination is left BOUGHT rather than failed: the crypto is genuinely
   * held at the provider and only needs an address to come home.
   */
  public async withdrawBoughtBatches(): Promise<number> {
    const prisma = await this.dbProvider.getClient()
    const bought = await prisma.treasuryReplenishBatch.findMany({
      where: { status: TreasuryReplenishStatus.BOUGHT, withdrawalId: null },
    })

    if (bought.length === 0) {
      return 0
    }

    let withdrawn = 0
    for (const batch of bought) {
      if (!batch.boughtAmount || batch.boughtAmount <= 0) {
        this.logger.error('Bought replenish batch carries no usable quantity', { batchId: batch.id })
        continue
      }

      const address = await this.resolveTreasuryAddress(batch.asset)
      if (!address) {
        // The crypto is genuinely held at the provider and only needs a
        // destination, so the batch stays BOUGHT for the next tick.
        continue
      }

      const result = await this.purchaseService.withdrawToTreasury({
        address,
        amount: batch.boughtAmount,
        asset: batch.asset,
        network: ULTRA_WITHDRAWAL_NETWORK,
        operationId: `replenish:${batch.id}`,
      })

      if (!result.success) {
        this.logger.error('Treasury replenish withdrawal was not accepted', {
          batchId: batch.id,
          code: result.code,
          reason: result.reason,
        })
        continue
      }

      await prisma.$transaction(async (tx) => {
        await tx.treasuryReplenishBatch.update({
          data: {
            settledAt: new Date(),
            status: TreasuryReplenishStatus.WITHDRAWN,
            withdrawalId: result.withdrawalId,
          },
          where: { id: batch.id },
        })
        await tx.treasuryReplenishRequest.updateMany({
          data: { status: ReplenishLegStatus.SETTLED },
          where: { batchId: batch.id },
        })
      })
      withdrawn += 1
    }

    return withdrawn
  }

  private async failBatch(batchId: string, reason: string): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    await prisma.$transaction(async (tx) => {
      await tx.treasuryReplenishBatch.update({
        data: { failureReason: reason, status: TreasuryReplenishStatus.FAILED },
        where: { id: batchId },
      })
      // Release the legs so a later tick can re-pool them; the customers they
      // represent were paid long ago and the obligation does not disappear.
      await tx.treasuryReplenishRequest.updateMany({
        data: { batchId: null, status: ReplenishLegStatus.PENDING },
        where: { batchId },
      })
    })
  }

  private groupByCorridor(legs: PendingLeg[]): Map<string, PendingLeg[]> {
    const groups = new Map<string, PendingLeg[]>()
    for (const leg of legs) {
      const key = `${leg.asset}:${leg.destNetwork}:${leg.fiatCurrency}`
      const existing = groups.get(key)
      if (existing) {
        existing.push(leg)
      }
      else {
        groups.set(key, [leg])
      }
    }
    return groups
  }

  /**
   * Asks Binance for the deposit address of this asset on Polygon, the same way
   * the bridge resolves its own destination.
   *
   * Nothing is hardcoded or stored: an address only has value while someone
   * holds its key, and a stale or mistyped constant would send real USDC
   * somewhere unrecoverable. Landing the funds at Binance is also where the
   * existing bridge already picks USDC up to reach the hot wallets that paid
   * the customer, so the loop closes without a second bridge.
   */
  private async resolveTreasuryAddress(asset: CryptoCurrency): Promise<null | string> {
    try {
      const provider = this.exchangeProviderFactory.getExchangeProviderById('binance')
      const result = await provider.getExchangeAddress({
        blockchain: ULTRA_WITHDRAWAL_NETWORK,
        cryptoCurrency: asset,
      })
      if (!result.success) {
        this.logger.error('Binance deposit address unavailable for replenish', {
          asset,
          code: result.code,
          reason: result.reason,
        })
        return null
      }
      // A memo would mean the venue cannot be credited by address alone, which
      // Ultra's withdrawal contract has no way to carry.
      if (result.memo) {
        this.logger.error('Binance deposit address requires a memo, which a vault withdrawal cannot carry', {
          asset,
        })
        return null
      }
      return result.address.trim() || null
    }
    catch (error) {
      this.logger.error('Could not resolve the treasury withdrawal address', {
        asset,
        reason: error instanceof Error ? error.message : 'unknown_error',
      })
      return null
    }
  }
}
