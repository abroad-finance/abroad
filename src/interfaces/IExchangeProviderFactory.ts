import { TargetCurrency } from '@prisma/client'

import { IExchangeProvider } from './IExchangeProvider'

export interface IExchangeProviderFactory {
  getExchangeProvider(currency: TargetCurrency): IExchangeProvider
}
