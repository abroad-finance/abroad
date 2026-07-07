import { BlockchainNetwork } from '@prisma/client'
import { ethers } from 'ethers'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { CryptoAssetConfigService } from '../../../payments/application/CryptoAssetConfigService'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

const ERC20_READ_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const

/**
 * ERC-20 balances of the Celo deposit wallet for every enabled asset config.
 * Address-only (CELO_DEPOSIT_ADDRESS) — the signing key never enters this path.
 */
@injectable()
export class CeloBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'CELO_HOT_WALLET' as const
  private cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string }
  private readonly decimalsCache = new Map<string, number>()

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
  ) {}

  public async getBalances(): Promise<TreasuryBalance[]> {
    const [{ CELO_DEPOSIT_ADDRESS: depositAddress, CELO_RPC_URL: rpcUrl }, enabledAssets] = await Promise.all([
      this.secretManager.getSecrets(['CELO_RPC_URL', 'CELO_DEPOSIT_ADDRESS']),
      this.assetConfigService.listEnabledAssets(BlockchainNetwork.CELO),
    ])

    const provider = this.getOrCreateProvider(rpcUrl)
    const owner = ethers.utils.getAddress(depositAddress)

    return Promise.all(enabledAssets.map(async (asset) => {
      const erc20 = new ethers.Contract(asset.mintAddress, ERC20_READ_ABI, provider)
      const [raw, decimals] = await Promise.all([
        erc20.balanceOf(owner) as Promise<ethers.BigNumber>,
        this.resolveDecimals(erc20, asset.mintAddress, asset.decimals),
      ])
      return {
        account: owner,
        amount: Number(ethers.utils.formatUnits(raw, decimals)),
        currency: asset.cryptoCurrency,
        venue: this.venue,
      }
    }))
  }

  private getOrCreateProvider(rpcUrl: string): ethers.providers.JsonRpcProvider {
    if (this.cachedProvider?.rpcUrl === rpcUrl) {
      return this.cachedProvider.provider
    }
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    this.cachedProvider = { provider, rpcUrl }
    return provider
  }

  // Mirrors CeloWalletHandler.resolveTokenDecimals: a null-decimals config is
  // a supported state, and assuming 18 for a 6-decimal USDC/USDT would
  // understate the balance by 10^12 — read decimals() on-chain instead.
  private async resolveDecimals(
    erc20: ethers.Contract,
    mintAddress: string,
    configured: null | number,
  ): Promise<number> {
    if (configured !== null && Number.isFinite(configured)) return configured
    const cached = this.decimalsCache.get(mintAddress)
    if (cached !== undefined) return cached
    const decimals: number = await erc20.decimals()
    this.decimalsCache.set(mintAddress, decimals)
    return decimals
  }
}
