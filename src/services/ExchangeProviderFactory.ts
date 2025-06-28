import { TargetCurrency } from '@prisma/client'
import { inject, named } from 'inversify'

import { IExchangeProvider } from '../interfaces/IExchangeProvider'
import { IExchangeProviderFactory } from '../interfaces/IExchangeProviderFactory'
import { TYPES } from '../types'

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
