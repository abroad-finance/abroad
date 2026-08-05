import { BlockchainNetwork, CryptoCurrency, FlowDirection, TargetCurrency } from '@prisma/client'

export interface CorridorIdentifier {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  /**
   * Omitted by callers that predate the onramp. A corridor is only ever priced
   * in the direction it was configured for — the two directions carry separate
   * fees, limits and steps, so one is never a fallback for the other.
   */
  direction?: FlowDirection
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
