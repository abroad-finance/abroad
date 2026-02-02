import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { CryptoAssetCoverageDto, CryptoAssetCoverageResponse, CryptoAssetUpdateInput } from './cryptoAssetSchemas'

export type EnabledCryptoAsset = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  decimals: null | number
  mintAddress: string
}

export class CryptoAssetConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CryptoAssetConfigError'
  }
}

@injectable()
export class CryptoAssetConfigService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async getActiveMint(params: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }): Promise<null | { decimals: null | number, mintAddress: string }> {
    const client = await this.dbProvider.getClient()
    const config = await client.cryptoAssetConfig.findFirst({
      where: {
        blockchain: params.blockchain,
        cryptoCurrency: params.cryptoCurrency,
        enabled: true,
      },
    })

    if (!config || !config.mintAddress) {
      return null
    }

    return {
      decimals: config.decimals ?? null,
      mintAddress: config.mintAddress,
    }
  }

  public async listCoverage(): Promise<CryptoAssetCoverageResponse> {
    const client = await this.dbProvider.getClient()
    const configs = await client.cryptoAssetConfig.findMany()

    const configMap = new Map<string, typeof configs[number]>()
    configs.forEach((config) => {
      configMap.set(this.key(config.cryptoCurrency, config.blockchain), config)
    })

    const cryptoValues = Object.values(CryptoCurrency) as CryptoCurrency[]
    const blockchainValues = Object.values(BlockchainNetwork) as BlockchainNetwork[]

    const assets: CryptoAssetCoverageDto[] = []

    for (const cryptoCurrency of cryptoValues) {
      for (const blockchain of blockchainValues) {
        const config = configMap.get(this.key(cryptoCurrency, blockchain))
        if (!config) {
          assets.push({
            blockchain,
            cryptoCurrency,
            enabled: false,
            mintAddress: null,
            status: 'MISSING',
            updatedAt: null,
          })
          continue
        }

        assets.push({
          blockchain,
          cryptoCurrency,
          decimals: config.decimals,
          enabled: config.enabled,
          mintAddress: config.mintAddress,
          status: 'CONFIGURED',
          updatedAt: config.updatedAt,
        })
      }
    }

    const total = assets.length
    const configured = assets.filter(asset => asset.status === 'CONFIGURED').length
    const enabled = assets.filter(asset => asset.enabled).length
    const missing = total - configured

    return {
      assets,
      summary: {
        configured,
        enabled,
        missing,
        total,
      },
    }
  }

  public async listEnabledAssets(blockchain: BlockchainNetwork): Promise<EnabledCryptoAsset[]> {
    const client = await this.dbProvider.getClient()
    const configs = await client.cryptoAssetConfig.findMany({
      where: {
        blockchain,
        enabled: true,
        mintAddress: { not: null },
      },
    })

    const assets: EnabledCryptoAsset[] = []
    configs.forEach((config) => {
      if (!config.mintAddress) {
        return
      }

      assets.push({
        blockchain: config.blockchain,
        cryptoCurrency: config.cryptoCurrency,
        decimals: config.decimals ?? null,
        mintAddress: config.mintAddress,
      })
    })

    return assets
  }

  public async requireActiveMint(params: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }): Promise<{ decimals: null | number, mintAddress: string }> {
    const config = await this.getActiveMint(params)
    if (!config) {
      throw new CryptoAssetConfigError('Unsupported crypto asset configuration')
    }
    return config
  }

  public async resolveStellarAsset(params: {
    assetCode: string
    issuer: string
  }): Promise<EnabledCryptoAsset | null> {
    const cryptoCurrency = this.parseCryptoCurrency(params.assetCode)
    if (!cryptoCurrency) {
      return null
    }

    const client = await this.dbProvider.getClient()
    const config = await client.cryptoAssetConfig.findFirst({
      where: {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency,
        enabled: true,
        mintAddress: params.issuer,
      },
    })

    if (!config?.mintAddress) {
      return null
    }

    return {
      blockchain: config.blockchain,
      cryptoCurrency: config.cryptoCurrency,
      decimals: config.decimals ?? null,
      mintAddress: config.mintAddress,
    }
  }

  public async upsert(input: CryptoAssetUpdateInput): Promise<CryptoAssetCoverageDto> {
    const client = await this.dbProvider.getClient()
    const mintAddress = input.mintAddress?.trim() || null

    if (input.enabled && !mintAddress) {
      throw new CryptoAssetConfigError('Mint address is required when enabling a crypto asset')
    }

    const decimals = input.decimals ?? null

    await client.cryptoAssetConfig.upsert({
      create: {
        blockchain: input.blockchain,
        cryptoCurrency: input.cryptoCurrency,
        decimals,
        enabled: input.enabled,
        mintAddress,
      },
      update: {
        decimals,
        enabled: input.enabled,
        mintAddress,
      },
      where: {
        crypto_asset_unique: {
          blockchain: input.blockchain,
          cryptoCurrency: input.cryptoCurrency,
        },
      },
    })

    const coverage = await this.listCoverage()
    const updated = coverage.assets.find(asset => (
      asset.blockchain === input.blockchain && asset.cryptoCurrency === input.cryptoCurrency
    ))

    if (!updated) {
      throw new CryptoAssetConfigError('Updated crypto asset not found')
    }

    return updated
  }

  private key(cryptoCurrency: CryptoCurrency, blockchain: BlockchainNetwork): string {
    return `${cryptoCurrency}-${blockchain}`
  }

  private parseCryptoCurrency(value: string): CryptoCurrency | null {
    const normalized = value.trim().toUpperCase()
    const allowed = Object.values(CryptoCurrency) as string[]
    if (!allowed.includes(normalized)) {
      return null
    }
    return normalized as CryptoCurrency
  }
}
