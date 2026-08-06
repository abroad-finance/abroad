import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'
import { readStablebondConfig, StablebondConfig } from '../../application/stablebondConfig'

/**
 * The Stablebond position, read from its trustline on the Stellar hot wallet.
 *
 * Reported as its own venue rather than folded into `STELLAR_HOT_WALLET`,
 * because the two are not the same kind of money: bond tokens cannot fund a
 * payout until they are unwound. The board says so explicitly — the whole
 * position is `blockedAmount` and none of it is `availableAmount`, so nothing
 * downstream can mistake a yield position for spendable float.
 *
 * Address-only. No signing key is loaded here.
 */
@injectable()
export class StablebondBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'STABLEBOND_POSITION' as const
  private readonly config: null | StablebondConfig

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) {
    const configResult = readStablebondConfig()
    this.config = configResult.enabled ? configResult.config : null
  }

  public async getBalances(): Promise<TreasuryBalance[]> {
    // Disabled means the venue does not exist, not that it holds nothing: an
    // empty list leaves the board exactly as it was before this shipped.
    if (!this.config) return []

    const [horizonUrl, accountId] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_ACCOUNT_ID),
    ])

    // Throws if Horizon is unreachable, which is deliberate. The aggregator
    // turns that into a per-venue error chip; reporting zero would tell the
    // board we hold no position when we may well hold one.
    const account = await new Horizon.Server(horizonUrl).loadAccount(accountId)
    const line = account.balances.find(balance =>
      'asset_code' in balance
      && balance.asset_code === this.config?.assetCode
      && balance.asset_issuer === this.config.issuer)

    // No trustline is a real, readable answer: the position is genuinely zero.
    const amount = line ? Number(line.balance) : 0
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Stellar reported an unusable ${this.config.assetCode} trustline balance`)
    }

    return [{
      account: accountId,
      amount,
      availableAmount: 0,
      blockedAmount: amount,
      currency: this.config.symbol,
      outstandingAmount: null,
      reservedAmount: null,
      venue: this.venue,
    }]
  }
}
