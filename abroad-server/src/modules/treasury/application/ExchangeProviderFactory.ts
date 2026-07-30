import { BlockchainNetwork, TargetCurrency } from '@prisma/client'
import { inject, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IExchangeProvider } from './contracts/IExchangeProvider'
import { ExchangeProviderId, IExchangeProviderFactory } from './contracts/IExchangeProviderFactory'

export class ExchangeProviderFactory implements IExchangeProviderFactory {
  private readonly providers: IExchangeProvider[]
  private readonly providersById: ReadonlyMap<ExchangeProviderId, IExchangeProvider>

  public constructor(
    @inject(TYPES.IExchangeProvider) @named('transfero') transferoExchangeProvider: IExchangeProvider,
    @inject(TYPES.IExchangeProvider) @named('binance') binanceExchangeProvider: IExchangeProvider,
    @inject(TYPES.IExchangeProvider) @named('binance-brl') binanceBrlExchangeProvider: IExchangeProvider,
  ) {
    this.providers = [transferoExchangeProvider, binanceExchangeProvider, binanceBrlExchangeProvider]
    this.providersById = new Map<ExchangeProviderId, IExchangeProvider>([
      ['binance', binanceExchangeProvider],
      ['transfero', transferoExchangeProvider],
    ])
  }

  getExchangeProvider(currency: TargetCurrency): IExchangeProvider {
    return this.resolveExchangeProvider({ targetCurrency: currency })
  }

  getExchangeProviderById(providerId: ExchangeProviderId): IExchangeProvider {
    const provider = this.providersById.get(providerId)
    if (!provider) {
      throw new Error(`No exchange provider found for id: ${providerId}`)
    }
    return provider
  }

  getExchangeProviderForCapability(params: {
    blockchain?: BlockchainNetwork
    targetCurrency: TargetCurrency
  }): IExchangeProvider {
    return this.resolveExchangeProvider(params)
  }

  private resolveExchangeProvider(params: {
    blockchain?: BlockchainNetwork
    targetCurrency: TargetCurrency
  }): IExchangeProvider {
    const candidates = this.providers.filter(provider =>
      provider.capability?.targetCurrency === params.targetCurrency)
    if (candidates.length === 0) {
      throw new Error(`No exchange provider found for currency: ${params.targetCurrency}`)
    }

    if (!params.blockchain) {
      return candidates[0]
    }

    const exactBlockchainMatch = candidates.find(provider =>
      provider.capability?.blockchain === params.blockchain)
    if (exactBlockchainMatch) {
      return exactBlockchainMatch
    }

    const blockchainAgnosticProvider = candidates.find(provider =>
      provider.capability?.blockchain === undefined)
    if (blockchainAgnosticProvider) {
      return blockchainAgnosticProvider
    }

    throw new Error(`No exchange provider found for currency: ${params.targetCurrency}`)
  }
}
