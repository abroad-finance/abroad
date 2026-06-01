import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export interface CorridorIdentifier {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  targetCurrency: TargetCurrency
}

export interface CorridorPricing {
  exchangeFeePct: number
  fixedFee: number
  maxAmount: null | number
  minAmount: null | number
}

export interface ICorridorPricingProvider {
  getPricing(corridor: CorridorIdentifier): Promise<CorridorPricing>
}
