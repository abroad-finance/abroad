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
