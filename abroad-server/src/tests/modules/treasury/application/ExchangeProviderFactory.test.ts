import 'reflect-metadata'
import { BlockchainNetwork, TargetCurrency } from '@prisma/client'

import type { ILockManager } from '../../../../platform/cacheLock/ILockManager'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { TransferoUltraClient } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { ExchangeProviderFactory } from '../../../../modules/treasury/application/ExchangeProviderFactory'
import { BinanceBrlExchangeProvider, BinanceExchangeProvider } from '../../../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from '../../../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { createMockLogger } from '../../../setup/mockFactories'

const secretManager = { getSecret: jest.fn(), getSecrets: jest.fn() } as unknown as ISecretManager
const lockManager = {
  withLock: jest.fn(async <T>(_key: string, _ttlMs: number, operation: () => Promise<T>) => operation()),
} as ILockManager
const ultraClient = {
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
} as unknown as TransferoUltraClient

const buildFactory = () => {
  const logger = createMockLogger()
  const transfero = new TransferoExchangeProvider(ultraClient, lockManager, logger)
  const binance = new BinanceExchangeProvider(secretManager, logger)
  const binanceBrl = new BinanceBrlExchangeProvider(secretManager, logger)
  const factory = new ExchangeProviderFactory(transfero, binance, binanceBrl)
  return { binance, binanceBrl, factory, transfero }
}

describe('ExchangeProviderFactory BRL routing', () => {
  it('resolves operational venues by exact identity', () => {
    const { binance, factory, transfero } = buildFactory()

    expect(factory.getExchangeProviderById('binance')).toBe(binance)
    expect(factory.getExchangeProviderById('transfero')).toBe(transfero)
  })

  it('routes a SOLANA-funded BRL corridor to Transfero for settlement', () => {
    const { factory, transfero } = buildFactory()
    const provider = factory.getExchangeProviderForCapability({
      blockchain: BlockchainNetwork.SOLANA,
      targetCurrency: TargetCurrency.BRL,
    })
    expect(provider).toBe(transfero)
  })

  it('keeps source-chain capability routing separate from the Polygon treasury hop', () => {
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

  it('rejects an unknown operational venue instead of falling back by currency', () => {
    const { factory } = buildFactory()

    expect(() => factory.getExchangeProviderById('unknown' as never))
      .toThrow('No exchange provider found for id: unknown')
  })
})
