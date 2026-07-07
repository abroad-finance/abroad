import { BlockchainNetwork } from '@prisma/client'
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, PublicKey } from '@solana/web3.js'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

/**
 * SPL token balances of the Solana hot wallet for every enabled asset config,
 * probing both the classic and Token-2022 associated accounts (mirrors
 * SolanaPaymentVerifier). Address-only — no signing key in this path.
 */
@injectable()
export class SolanaBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'SOLANA_HOT_WALLET' as const

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
  ) {}

  public async getBalances(): Promise<TreasuryBalance[]> {
    const [rpcUrl, address, enabledAssets] = await Promise.all([
      this.secretManager.getSecret('SOLANA_RPC_URL'),
      this.secretManager.getSecret('SOLANA_ADDRESS'),
      this.assetConfigService.listEnabledAssets(BlockchainNetwork.SOLANA),
    ])

    const connection = new Connection(rpcUrl, 'confirmed')
    const owner = new PublicKey(address)

    return Promise.all(enabledAssets.map(async (asset) => {
      const mint = new PublicKey(asset.mintAddress)
      const [classicAta, token2022Ata] = await Promise.all([
        getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID),
        getAssociatedTokenAddress(mint, owner, false, TOKEN_2022_PROGRAM_ID),
      ])

      const amounts = await Promise.all([classicAta, token2022Ata].map(async (ata) => {
        try {
          const { value } = await connection.getTokenAccountBalance(ata)
          return value.uiAmount ?? 0
        }
        catch (error) {
          // Only a missing associated account is a legitimate zero. Anything
          // else (RPC outage, rate limit, network) must bubble so the
          // aggregator shows a venue error instead of a fake 0 balance.
          const message = error instanceof Error ? error.message : ''
          if (/could not find account|invalid param/i.test(message)) {
            return 0
          }
          throw error
        }
      }))

      return {
        account: address,
        amount: amounts.reduce((sum, amount) => sum + amount, 0),
        currency: asset.cryptoCurrency,
        venue: this.venue,
      }
    }))
  }
}
