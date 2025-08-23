import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export interface IExchangeProvider {
  createMarketOrder(params: {
    sourceAmount: number
    sourceCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }): Promise<{ success: boolean }>
  readonly exchangePercentageFee: number

  getExchangeAddress(params: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }
  ): Promise<{ address: string, memo?: string }>

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
  }
  ): Promise<number>
}
