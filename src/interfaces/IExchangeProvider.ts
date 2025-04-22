import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export interface IExchangeProvider {
  readonly exchangePercentageFee: number
  getExchangeAddress(params: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }
  ): Promise<{ address: string, memo?: string }>

  getExchangeRate(params: {
    sourceCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }
  ): Promise<number>
}
