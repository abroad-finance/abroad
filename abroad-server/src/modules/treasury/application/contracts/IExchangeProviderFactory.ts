import { BlockchainNetwork, TargetCurrency } from '@prisma/client'

import { IExchangeProvider } from './IExchangeProvider'

export const EXCHANGE_PROVIDER_IDS = ['binance', 'transfero'] as const

export type ExchangeProviderId = typeof EXCHANGE_PROVIDER_IDS[number]

export interface IExchangeProviderFactory {
  getExchangeProvider(currency: TargetCurrency): IExchangeProvider
  getExchangeProviderById(providerId: ExchangeProviderId): IExchangeProvider
  getExchangeProviderForCapability?(params: {
    blockchain?: BlockchainNetwork
    targetCurrency: TargetCurrency
  }): IExchangeProvider
}
