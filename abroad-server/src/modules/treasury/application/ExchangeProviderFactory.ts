import { BlockchainNetwork, TargetCurrency } from '@prisma/client'
import { inject, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IExchangeProvider } from './contracts/IExchangeProvider'
import { IExchangeProviderFactory } from './contracts/IExchangeProviderFactory'

export class ExchangeProviderFactory implements IExchangeProviderFactory {
  private readonly providers: IExchangeProvider[]

  public constructor(
    @inject(TYPES.IExchangeProvider) @named('transfero') transferoExchangeProvider: IExchangeProvider,
    @inject(TYPES.IExchangeProvider) @named('binance') binanceExchangeProvider: IExchangeProvider,
  ) {
    this.providers = [transferoExchangeProvider, binanceExchangeProvider]
  }

  getExchangeProvider(currency: TargetCurrency): IExchangeProvider {
    return this.getExchangeProviderForCapability({ targetCurrency: currency })
  }

  getExchangeProviderForCapability(params: {
    blockchain?: BlockchainNetwork
    targetCurrency: TargetCurrency
  }): IExchangeProvider {
    const match = this.providers.find(provider =>
      provider.capability
      && provider.capability.targetCurrency === params.targetCurrency
      && (params.blockchain === undefined || provider.capability.blockchain === params.blockchain),
    )
    if (match) return match
    throw new Error(`No exchange provider found for currency: ${params.targetCurrency}`)
  }
}
