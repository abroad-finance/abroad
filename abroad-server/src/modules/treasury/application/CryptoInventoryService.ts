import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { inject, injectable, multiInject } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { ITreasuryBalanceSource, TreasuryVenue } from './contracts/ITreasuryBalanceSource'

const HOT_WALLET_VENUE_BY_NETWORK: Readonly<Partial<Record<BlockchainNetwork, TreasuryVenue>>> = {
  [BlockchainNetwork.CELO]: 'CELO_HOT_WALLET',
  [BlockchainNetwork.SOLANA]: 'SOLANA_HOT_WALLET',
  [BlockchainNetwork.STELLAR]: 'STELLAR_HOT_WALLET',
}

type CryptoInventoryResult
  = | { available: number, success: true }
    | { reason: string, success: false }

/**
 * Reads how much of an asset the hot wallet on one chain can actually pay out.
 *
 * A FIAT_TO_CRYPTO transaction promises the customer crypto before any
 * replenish has happened, so acceptance has to know the float is really there.
 * A failed read is never reported as a balance in either direction: callers get
 * an explicit failure and reject, because quoting against an unknown float
 * would promise coins we might not hold.
 */
@injectable()
export class CryptoInventoryService {
  private readonly cache = new Map<string, { available: number, fetchedAt: number }>()
  private readonly logger: ScopedLogger
  private readonly sourcesByVenue: Map<TreasuryVenue, ITreasuryBalanceSource>
  private readonly ttlMs: number

  public constructor(
    @multiInject(TYPES.ITreasuryBalanceSource) sources: ITreasuryBalanceSource[],
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'CryptoInventory' })
    this.sourcesByVenue = new Map(sources.map(source => [source.venue, source]))
    this.ttlMs = this.readPositiveInteger('CRYPTO_INVENTORY_CACHE_TTL_MS', 30_000)
  }

  public async getAvailable(params: {
    cryptoCurrency: CryptoCurrency
    network: BlockchainNetwork
    now?: number
  }): Promise<CryptoInventoryResult> {
    const venue = HOT_WALLET_VENUE_BY_NETWORK[params.network]
    if (!venue) {
      return { reason: `no_hot_wallet_for_network:${params.network}`, success: false }
    }
    const source = this.sourcesByVenue.get(venue)
    if (!source) {
      return { reason: `no_balance_source_for_venue:${venue}`, success: false }
    }

    const now = params.now ?? Date.now()
    const key = `${venue}:${params.cryptoCurrency}`
    const cached = this.cache.get(key)
    if (cached && now - cached.fetchedAt <= this.ttlMs) {
      return { available: cached.available, success: true }
    }

    try {
      const balances = await source.getBalances()
      const match = balances.find(balance => balance.currency === params.cryptoCurrency)
      if (!match) {
        return {
          reason: `asset_not_held:${params.cryptoCurrency}@${venue}`,
          success: false,
        }
      }
      // availableAmount is the venue's own spendable figure where it draws the
      // distinction; amount is the whole position otherwise.
      const available = match.availableAmount ?? match.amount
      if (!Number.isFinite(available) || available < 0) {
        return { reason: 'balance_source_returned_unusable_amount', success: false }
      }

      this.cache.set(key, { available, fetchedAt: now })
      return { available, success: true }
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error'
      this.logger.error('Hot wallet inventory read failed', {
        cryptoCurrency: params.cryptoCurrency,
        network: params.network,
        reason,
        venue,
      })
      return { reason, success: false }
    }
  }

  private readPositiveInteger(key: string, fallback: number): number {
    const raw = process.env[key]
    if (!raw) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
}
