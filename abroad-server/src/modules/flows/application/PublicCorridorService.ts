import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { type ChainFamily, resolveChainMetadata, type WalletConnectMetadata } from '../../shared/chainMetadata'

export type PublicCorridorDto = {
  blockchain: BlockchainNetwork
  chainFamily: ChainFamily
  chainId: string
  cryptoCurrency: CryptoCurrency
  maxAmount: null | number
  minAmount: null | number
  notify: {
    endpoint: null | string
    required: boolean
  }
  paymentMethod: PaymentMethod
  targetCurrency: TargetCurrency
  walletConnect: WalletConnectMetadata
}

export type PublicCorridorResponse = {
  corridors: PublicCorridorDto[]
}

@injectable()
export class PublicCorridorService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async list(): Promise<PublicCorridorResponse> {
    const client = await this.dbProvider.getClient()

    const [definitions, unsupported, enabledAssets] = await Promise.all([
      client.flowDefinition.findMany({
        select: {
          blockchain: true,
          cryptoCurrency: true,
          enabled: true,
          maxAmount: true,
          minAmount: true,
          payoutProvider: true,
          targetCurrency: true,
        },
        where: { enabled: true },
      }),
      client.flowCorridor.findMany({
        select: { blockchain: true, cryptoCurrency: true, targetCurrency: true },
        where: { status: FlowCorridorStatus.UNSUPPORTED },
      }),
      client.cryptoAssetConfig.findMany({
        select: { blockchain: true, cryptoCurrency: true },
        where: { enabled: true, mintAddress: { not: null } },
      }),
    ])

    const unsupportedSet = new Set(
      unsupported.map(item => this.key(item.cryptoCurrency, item.blockchain, item.targetCurrency)),
    )

    const enabledAssetSet = new Set(
      enabledAssets.map(item => this.assetKey(item.cryptoCurrency, item.blockchain)),
    )

    const corridors: PublicCorridorDto[] = []

    for (const def of definitions) {
      if (!enabledAssetSet.has(this.assetKey(def.cryptoCurrency, def.blockchain))) {
        continue
      }

      const key = this.key(def.cryptoCurrency, def.blockchain, def.targetCurrency)
      if (unsupportedSet.has(key)) {
        continue
      }

      const chainMeta = resolveChainMetadata(def.blockchain)
      corridors.push({
        blockchain: def.blockchain,
        chainFamily: chainMeta.family,
        chainId: chainMeta.chainId,
        cryptoCurrency: def.cryptoCurrency,
        maxAmount: def.maxAmount ?? null,
        minAmount: def.minAmount ?? null,
        notify: this.resolveNotify(def.blockchain),
        paymentMethod: def.payoutProvider,
        targetCurrency: def.targetCurrency,
        walletConnect: chainMeta.walletConnect,
      })
    }

    return { corridors }
  }

  private assetKey(cryptoCurrency: CryptoCurrency, blockchain: BlockchainNetwork): string {
    return `${cryptoCurrency}-${blockchain}`
  }

  private key(cryptoCurrency: CryptoCurrency, blockchain: BlockchainNetwork, targetCurrency: TargetCurrency): string {
    return `${cryptoCurrency}-${blockchain}-${targetCurrency}`
  }

  private resolveNotify(blockchain: BlockchainNetwork): { endpoint: null | string, required: boolean } {
    if (blockchain === BlockchainNetwork.STELLAR) {
      return { endpoint: null, required: false }
    }

    return {
      endpoint: '/payments/notify',
      required: true,
    }
  }
}
