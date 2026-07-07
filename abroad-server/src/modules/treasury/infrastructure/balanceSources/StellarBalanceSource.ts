import { BlockchainNetwork } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

/**
 * Trustline balances of the Stellar hot wallet, matched against the enabled
 * asset configs (code + issuer) so unrelated trustlines never leak into the
 * treasury board. Address-only — no signing key is ever loaded here.
 */
@injectable()
export class StellarBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'STELLAR_HOT_WALLET' as const

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
  ) {}

  public async getBalances(): Promise<TreasuryBalance[]> {
    const [horizonUrl, accountId, enabledAssets] = await Promise.all([
      this.secretManager.getSecret('STELLAR_HORIZON_URL'),
      this.secretManager.getSecret('STELLAR_ACCOUNT_ID'),
      this.assetConfigService.listEnabledAssets(BlockchainNetwork.STELLAR),
    ])

    const server = new Horizon.Server(horizonUrl)
    const account = await server.loadAccount(accountId)

    return enabledAssets.map((asset) => {
      const line = account.balances.find(balance =>
        'asset_code' in balance
        && balance.asset_code === asset.cryptoCurrency
        && balance.asset_issuer === asset.mintAddress)
      return {
        account: accountId,
        amount: line ? Number(line.balance) || 0 : 0,
        currency: asset.cryptoCurrency,
        venue: this.venue,
      }
    })
  }
}
