import { TargetCurrency } from '@prisma/client'
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
    switch (currency) {
      case TargetCurrency.BRL:
        return this.transferoExchangeProvider
      case TargetCurrency.COP:
        return this.binanceExchangeProvider
      default:
        throw new Error(`No exchange provider found for currency: ${currency}`)
    }
  }
}
