import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'
import { type ChainFamily, resolveChainMetadata } from '../../shared/chainMetadata'
import { CryptoAssetConfigService } from './CryptoAssetConfigService'

export type PaymentContext = {
  amount: number
  blockchain: BlockchainNetwork
  chainFamily: ChainFamily
  chainId: string
  cryptoCurrency: CryptoCurrency
  decimals: null | number
  depositAddress: string
  memo: null | string
  memoType: 'text' | null
  mintAddress: null | string
  notify: PaymentNotifyContext
  rpcUrl: null | string
}

export type PaymentNotifyContext = {
  endpoint: null | string
  required: boolean
}

@injectable()
export class PaymentContextService {
  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
  ) {}

  public async build(params: {
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    transactionReference: null | string
  }): Promise<PaymentContext> {
    const chainMeta = resolveChainMetadata(params.blockchain)
    const assetConfig = await this.assetConfigService.getActiveMint({
      blockchain: params.blockchain,
      cryptoCurrency: params.cryptoCurrency,
    })

    const { depositAddress, rpcUrl } = await this.resolveChainConfig(params.blockchain)

    return {
      amount: params.amount,
      blockchain: params.blockchain,
      chainFamily: chainMeta.family,
      chainId: chainMeta.chainId,
      cryptoCurrency: params.cryptoCurrency,
      decimals: assetConfig?.decimals ?? null,
      depositAddress,
      memo: params.blockchain === BlockchainNetwork.STELLAR ? params.transactionReference : null,
      memoType: params.blockchain === BlockchainNetwork.STELLAR ? 'text' : null,
      mintAddress: assetConfig?.mintAddress ?? null,
      notify: this.resolveNotify(params.blockchain),
      rpcUrl,
    }
  }

  private async resolveChainConfig(blockchain: BlockchainNetwork): Promise<{ depositAddress: string, rpcUrl: null | string }> {
    if (blockchain === BlockchainNetwork.STELLAR) {
      const secrets = await this.secretManager.getSecrets([
        Secrets.STELLAR_ACCOUNT_ID,
        Secrets.STELLAR_HORIZON_URL,
      ])
      return {
        depositAddress: secrets.STELLAR_ACCOUNT_ID,
        rpcUrl: secrets.STELLAR_HORIZON_URL,
      }
    }

    if (blockchain === BlockchainNetwork.SOLANA) {
      const secrets = await this.secretManager.getSecrets([
        Secrets.SOLANA_ADDRESS,
        Secrets.SOLANA_RPC_URL,
      ])
      return {
        depositAddress: secrets.SOLANA_ADDRESS,
        rpcUrl: secrets.SOLANA_RPC_URL,
      }
    }

    const secrets = await this.secretManager.getSecrets([
      Secrets.CELO_DEPOSIT_ADDRESS,
      Secrets.CELO_RPC_URL,
    ])

    return {
      depositAddress: secrets.CELO_DEPOSIT_ADDRESS,
      rpcUrl: secrets.CELO_RPC_URL,
    }
  }

  private resolveNotify(blockchain: BlockchainNetwork): PaymentNotifyContext {
    if (blockchain === BlockchainNetwork.STELLAR) {
      return { endpoint: null, required: false }
    }

    return {
      endpoint: '/payments/notify',
      required: true,
    }
  }
}
