import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

import type { ILockManager } from '../../../../../platform/cacheLock/ILockManager'

import { TransferoUltraClient, TransferoUltraError } from '../../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { TransferoExchangeProvider } from '../../../../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { createMockLogger } from '../../../../setup/mockFactories'

type UltraClientMock = jest.Mocked<
  Pick<TransferoUltraClient, 'get' | 'patch' | 'post'>
>

const SESSION_ID = 'sess_11111111-2222-4333-8444-555555555555'
const TRADE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const createUltraClient = (): UltraClientMock => ({
  get: jest.fn(),
  patch: jest.fn(),
  post: jest.fn(),
})

const createBalanceResponse = (available: string) => [{
  asset: 'USDC',
  available,
  blocked: '0',
  credit: '0',
  ledgerBalance: available,
  openDebt: '0',
  openWithdrawals: '0',
  overdueDebt: '0',
  owedDue: '0',
  processing: '0',
}]

const createProvider = () => {
  const ultraClient = createUltraClient()
  ultraClient.get.mockResolvedValue(createBalanceResponse('5'))
  const logger = createMockLogger()
  const lockManager: ILockManager = {
    withLock: jest.fn(async <T>(_key: string, _ttlMs: number, operation: () => Promise<T>) => operation()),
  }
  const provider = new TransferoExchangeProvider(
    ultraClient as unknown as TransferoUltraClient,
    lockManager,
    logger,
  )
  return { lockManager, logger, provider, ultraClient }
}

const otcSession = {
  amount: 5,
  client_name: 'Abroad',
  created_at: '2026-07-27T10:00:00.000Z',
  currency: 'USDC',
  expires_at: '2026-07-27T10:00:10.000Z',
  price: 5,
  session_id: SESSION_ID,
  settlement: 'D0',
  side: 'SELL',
  spot: 5,
  status: 'OPEN',
  total_brl: 25,
}

describe('TransferoExchangeProvider', () => {
  it('uses the Ultra Polygon vault address and treats blank tags as absent', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.get.mockResolvedValue([
      {
        address: '0xbrz',
        asset: 'BRZ',
        blockchain: 'POLYGON',
        id: '99999999-2222-4333-8444-555555555555',
        network: 'mainnet',
        tag: null,
      },
      {
        address: '0xtestnet',
        asset: 'USDC',
        blockchain: 'POLYGON',
        id: '88888888-2222-4333-8444-555555555555',
        network: 'amoy',
        tag: '',
      },
      {
        address: '0x1111222233334444555566667777888899990000',
        asset: 'USDC',
        blockchain: 'POLYGON',
        id: '11111111-2222-4333-8444-555555555555',
        network: 'mainnet',
        tag: '',
      },
    ])

    await expect(provider.getExchangeAddress({
      blockchain: 'POLYGON',
      cryptoCurrency: CryptoCurrency.USDC,
    })).resolves.toEqual({
      address: '0x1111222233334444555566667777888899990000',
      success: true,
    })
    expect(provider.getDepositNetwork({
      cryptoCurrency: CryptoCurrency.USDC,
    })).toBe('POLYGON')
    expect(ultraClient.get).toHaveBeenCalledWith('/api/v1/vault/addresses')
  })

  it.each([
    BlockchainNetwork.CELO,
    BlockchainNetwork.SOLANA,
    BlockchainNetwork.STELLAR,
  ])('rejects direct %s deposits before looking up an address', async (blockchain) => {
    const { provider, ultraClient } = createProvider()

    await expect(provider.getExchangeAddress({
      blockchain,
      cryptoCurrency: CryptoCurrency.USDC,
    })).resolves.toEqual({
      code: 'validation',
      reason: `transfero_ultra_unsupported_blockchain:${blockchain}`,
      success: false,
    })
    expect(ultraClient.get).not.toHaveBeenCalled()
  })

  it('inverts Ultra all-in D0 SELL prices for the quote use case', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.get.mockResolvedValue({
      prices: {
        USDC: {
          D0: { price: 5 },
        },
      },
      spot: 5.03,
      timestamp: '2026-07-27T10:00:00.000Z',
    })

    await expect(provider.getExchangeRate({
      sourceAmount: 10,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toBeCloseTo(0.2)
    expect(ultraClient.get).toHaveBeenCalledWith(
      '/api/v1/otc/prices',
      { side: 'SELL' },
    )
  })

  it('creates, confirms, and fully settles a D0 SELL session from holdings', async () => {
    const { lockManager, provider, ultraClient } = createProvider()
    ultraClient.post
      .mockResolvedValueOnce(otcSession)
      .mockResolvedValueOnce({ swept: '5.00000000' })
    ultraClient.patch.mockResolvedValue({
      closing: {},
      trade: { id: TRADE_ID },
    })

    await expect(provider.createMarketOrder({
      operationId: 'transaction-1:exchange:6',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({ success: true })

    expect(lockManager.withLock).toHaveBeenCalledWith(
      'transfero-ultra:otc-sale',
      60_000,
      expect.any(Function),
    )
    expect(ultraClient.get).toHaveBeenCalledWith('/api/v1/balance')
    expect(ultraClient.post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/otc/sessions',
      {
        amount: 5,
        currency: CryptoCurrency.USDC,
        settlement: 'D0',
        side: 'SELL',
        validity_seconds: 10,
      },
      'abroad:otc:transaction-1:exchange:6:session',
    )
    expect(ultraClient.patch).toHaveBeenCalledWith(
      `/api/v1/otc/sessions/${SESSION_ID}`,
      {
        oid: 'transaction-1:exchange:6',
        side: 'SELL',
        source: 'api',
      },
      'abroad:otc:transaction-1:exchange:6:confirmation',
    )
    expect(ultraClient.post).toHaveBeenNthCalledWith(
      2,
      `/api/v1/otc/trades/${TRADE_ID}/settle-from-holdings`,
      undefined,
      'abroad:otc:transaction-1:exchange:6:settlement',
    )
  })

  it('waits without creating an OTC session when available holdings are insufficient', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.get.mockResolvedValueOnce(createBalanceResponse('4.99999998'))

    await expect(provider.createMarketOrder({
      operationId: 'transaction-waiting',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({
      code: 'insufficient_balance',
      reason: 'transfero_ultra_insufficient_available_holdings',
      success: false,
    })

    expect(ultraClient.post).not.toHaveBeenCalled()
    expect(ultraClient.patch).not.toHaveBeenCalled()
  })

  it('fails closed without mutating when the requested balance row is missing', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.get.mockResolvedValueOnce([])

    await expect(provider.createMarketOrder({
      operationId: 'transaction-missing-balance',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_balance_asset_missing:USDC',
      success: false,
    })

    expect(ultraClient.post).not.toHaveBeenCalled()
    expect(ultraClient.patch).not.toHaveBeenCalled()
  })

  it('fails closed when holdings do not settle the complete requested amount', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.post
      .mockResolvedValueOnce(otcSession)
      .mockResolvedValueOnce({ swept: '4.90000000' })
    ultraClient.patch.mockResolvedValue({
      closing: {},
      trade: { id: TRADE_ID },
    })

    await expect(provider.createMarketOrder({
      operationId: 'transaction-partial',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_partial_holdings_settlement:4.90000000',
      success: false,
    })
  })

  it('does not confirm a session whose locked trade differs from the request', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.post.mockResolvedValue({
      ...otcSession,
      amount: 6,
    })

    await expect(provider.createMarketOrder({
      operationId: 'transaction-session-mismatch',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_otc_session_mismatch:amount',
      success: false,
    })
    expect(ultraClient.patch).not.toHaveBeenCalled()
    expect(ultraClient.post).toHaveBeenCalledTimes(1)
  })

  it('preserves Ultra failure classification and treats malformed responses as permanent', async () => {
    const { provider, ultraClient } = createProvider()
    ultraClient.post
      .mockRejectedValueOnce(new TransferoUltraError({
        code: 'retriable',
        message: 'Transfero Ultra HTTP_503',
        status: 503,
      }))
      .mockResolvedValueOnce({ session_id: 'invalid' })

    await expect(provider.createMarketOrder({
      operationId: 'transaction-retry',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({
      code: 'retriable',
      reason: 'Transfero Ultra HTTP_503',
      success: false,
    })
    await expect(provider.createMarketOrder({
      operationId: 'transaction-schema',
      sourceAmount: 5,
      sourceCurrency: CryptoCurrency.USDC,
      targetCurrency: TargetCurrency.BRL,
    })).resolves.toEqual({
      code: 'permanent',
      reason: 'transfero_ultra_otc_schema_mismatch',
      success: false,
    })
  })
})
