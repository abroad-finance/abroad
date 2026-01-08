import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

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

export type ExchangeProviderCapability = {
  blockchain?: BlockchainNetwork
  targetCurrency: TargetCurrency
}

export type ExchangeFailureCode = 'validation' | 'retriable' | 'permanent'

export type ExchangeAddressResult =
  | { success: true, address: string, memo?: string }
  | { success: false, code?: ExchangeFailureCode, reason?: string }

export type ExchangeOperationResult =
  | { success: true }
  | { success: false, code?: ExchangeFailureCode, reason?: string }
