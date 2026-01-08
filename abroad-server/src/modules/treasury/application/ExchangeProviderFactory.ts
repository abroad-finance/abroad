import { BlockchainNetwork, TargetCurrency } from '@prisma/client'
import { inject, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IExchangeProvider } from './contracts/IExchangeProvider'
import { IExchangeProviderFactory } from './contracts/IExchangeProviderFactory'

export class ExchangeProviderFactory implements IExchangeProviderFactory {
  public constructor(
    @inject(TYPES.IExchangeProvider) @named('transfero') private transferoExchangeProvider: IExchangeProvider,
    @inject(TYPES.IExchangeProvider) @named('binance') private binanceExchangeProvider: IExchangeProvider,
  ) { }

  getExchangeProvider(currency: TargetCurrency): IExchangeProvider {
    return this.getExchangeProviderForCapability({ targetCurrency: currency })
  }

  getExchangeProviderForCapability(params: {
    blockchain?: BlockchainNetwork
    targetCurrency: TargetCurrency
  }): IExchangeProvider {
    const { targetCurrency } = params
    if (targetCurrency === TargetCurrency.BRL) {
      return this.transferoExchangeProvider
    }
    if (targetCurrency === TargetCurrency.COP) {
      return this.binanceExchangeProvider
    }
    throw new Error(`No exchange provider found for currency: ${targetCurrency}`)
  }
}
