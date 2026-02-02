import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { z } from 'zod'

export type CryptoAssetCoverageDto = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  decimals?: null | number
  enabled: boolean
  mintAddress?: null | string
  status: 'CONFIGURED' | 'MISSING'
  updatedAt?: Date | null
}

export type CryptoAssetCoverageResponse = {
  assets: CryptoAssetCoverageDto[]
  summary: CryptoAssetCoverageSummary
}

export type CryptoAssetCoverageSummary = {
  configured: number
  enabled: number
  missing: number
  total: number
}

export type CryptoAssetUpdateInput = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  decimals?: null | number
  enabled: boolean
  mintAddress?: null | string
}

export const cryptoAssetUpdateSchema: z.ZodType<CryptoAssetUpdateInput> = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  cryptoCurrency: z.nativeEnum(CryptoCurrency),
  decimals: z.number().int().min(0).max(18).nullable().optional(),
  enabled: z.boolean(),
  mintAddress: z.string().min(1).nullable().optional(),
})
