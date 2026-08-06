import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  FlowDirection,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { type ChainFamily, resolveChainMetadata, type WalletConnectMetadata } from '../../shared/chainMetadata'

export type PublicCorridorResponse = {
  corridors: PublicCorridorDto[]
}

type PublicCorridorDto = {
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

@injectable()
export class PublicCorridorService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  /**
   * Lists corridors for one direction at a time.
   *
   * The two directions of an asset pair are separate corridors with separate
   * economics and separate limits, and they collide on every field this DTO
   * exposes. Listing them together produced two indistinguishable entries for
   * the same pair, letting an onramp's limits be applied to a payout. The
   * parameter defaults to payouts so that callers written before the onramp
   * existed keep receiving exactly the corridors they always did.
   */
  public async list(
    direction: FlowDirection = FlowDirection.CRYPTO_TO_FIAT,
  ): Promise<PublicCorridorResponse> {
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
        where: { direction, enabled: true },
      }),
      client.flowCorridor.findMany({
        select: { blockchain: true, cryptoCurrency: true, targetCurrency: true },
        // Suppression is per direction too: an unsupported payout says nothing
        // about whether the same pair can be bought.
        where: { direction, status: FlowCorridorStatus.UNSUPPORTED },
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
