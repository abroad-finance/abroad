import 'reflect-metadata'
import { BlockchainNetwork, TargetCurrency } from '@prisma/client'

import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { ExchangeProviderFactory } from '../../../../modules/treasury/application/ExchangeProviderFactory'
import { BinanceBrlExchangeProvider, BinanceExchangeProvider } from '../../../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from '../../../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { createMockLogger } from '../../../setup/mockFactories'

const secretManager = { getSecret: jest.fn(), getSecrets: jest.fn() } as unknown as ISecretManager

const buildFactory = () => {
  const logger = createMockLogger()
  const transfero = new TransferoExchangeProvider(secretManager, logger)
  const binance = new BinanceExchangeProvider(secretManager, logger)
  const binanceBrl = new BinanceBrlExchangeProvider(secretManager, logger)
  const factory = new ExchangeProviderFactory(transfero, binance, binanceBrl)
  return { binanceBrl, factory, transfero }
}

describe('ExchangeProviderFactory BRL routing', () => {
  it('routes USDC on SOLANA → BRL to Transfero (which supports Solana deposits)', () => {
    const { factory, transfero } = buildFactory()
    const provider = factory.getExchangeProviderForCapability({
      blockchain: BlockchainNetwork.SOLANA,
      targetCurrency: TargetCurrency.BRL,
    })
    expect(provider).toBe(transfero)
  })

  it('routes STELLAR → BRL to Transfero', () => {
    const { factory, transfero } = buildFactory()
    expect(factory.getExchangeProviderForCapability({
      blockchain: BlockchainNetwork.STELLAR,
      targetCurrency: TargetCurrency.BRL,
    })).toBe(transfero)
  })

  it('routes CELO → BRL to the Binance BRL provider (exact blockchain match wins)', () => {
    const { binanceBrl, factory } = buildFactory()
    expect(factory.getExchangeProviderForCapability({
      blockchain: BlockchainNetwork.CELO,
      targetCurrency: TargetCurrency.BRL,
    })).toBe(binanceBrl)
  })
})
