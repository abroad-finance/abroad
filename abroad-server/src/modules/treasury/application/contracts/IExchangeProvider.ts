import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export type ExchangeAddressResult
  = | { address: string, memo?: string, success: true }
    | { code?: ExchangeFailureCode, reason?: string, success: false }

export type ExchangeFailureCode = 'permanent' | 'retriable' | 'validation'

export type ExchangeOperationResult
  = | { code?: ExchangeFailureCode, reason?: string, success: false }
    | { success: true }

export type ExchangeProviderCapability = {
  blockchain?: BlockchainNetwork
  targetCurrency: TargetCurrency
}

export interface IExchangeProvider {
  readonly capability?: ExchangeProviderCapability
  createMarketOrder(params: {
    sourceAmount: number
    sourceCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }): Promise<ExchangeOperationResult>
  readonly exchangePercentageFee: number

  /**
   * The blockchain this provider accepts deposits of `cryptoCurrency` on (e.g.
   * Transfero accepts USDC on Solana). Lets a treasury transfer derive BOTH the
   * destination deposit address and the source-venue withdraw network from one
   * authoritative value, so funds can never be sent to a mismatched chain.
   * Returns undefined when the provider has no deposit chain for the asset.
   */
  getDepositNetwork?(params: { cryptoCurrency: CryptoCurrency }): BlockchainNetwork | undefined

  getExchangeAddress(params: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }): Promise<ExchangeAddressResult>

  getExchangeRate(params: {
    sourceAmount: number
    sourceCurrency: CryptoCurrency
    targetAmount?: undefined
    targetCurrency: TargetCurrency
  } | {
    sourceAmount?: undefined
    sourceCurrency: CryptoCurrency
    targetAmount: number
    targetCurrency: TargetCurrency
  }): Promise<number>
}
