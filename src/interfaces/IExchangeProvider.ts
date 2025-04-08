import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export interface IExchangeProvider {
  getExchangeAddress(params: {
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }
  ): Promise<string>

  getExchangeRate(params: {
    sourceCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }
  ): Promise<number>
}
