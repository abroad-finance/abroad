import { act, renderHook } from '@testing-library/react'
import React from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  vi,
} from 'vitest'

import type { IWallet } from '../interfaces/IWallet'
import type { PublicCorridorResponse } from '../services/public/types'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type { WalletConnectRequest } from '../interfaces/IWallet'

import { NoticeProvider } from '../contexts/NoticeContext'
import { WalletAuthContext } from '../contexts/WalletAuthContext'
import { useWebSwapController } from '../pages/WebSwap/useWebSwapController'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const createStablecoinBalanceState = (overrides?: Partial<{
  cUsd: string
  highestBalanceToken: 'USDC' | 'USDT' | 'cUSD'
  isLoading: boolean
  preferredSupportedToken: 'USDC' | 'USDT' | null
  preferenceKind: 'empty' | 'supported' | 'unsupported-preferred'
  usdc: string
  usdt: string
}>) => {
  const cUsd = overrides?.cUsd ?? '0.00'
  const usdc = overrides?.usdc ?? '25.00'
  const usdt = overrides?.usdt ?? '5.00'
  const preferredSupportedToken = overrides?.preferredSupportedToken ?? 'USDC'
  const highestBalanceToken = overrides?.highestBalanceToken ?? 'USDC'
  const preferenceKind = overrides?.preferenceKind ?? 'supported'

  return {
    balances: {
      cUSD: cUsd,
      USDC: usdc,
      USDT: usdt,
    },
    cUsd,
    error: null,
    isLoading: overrides?.isLoading ?? false,
    preference: {
      highestBalanceToken,
      kind: preferenceKind,
      preferredSupportedToken,
    },
    refresh: vi.fn(async () => undefined),
    supportedBalanceFor: (symbol: 'USDC' | 'USDT') => (symbol === 'USDT' ? usdt : usdc),
    usdc,
    usdt,
  }
}

const stablecoinBalancesMock = vi.hoisted(() => vi.fn(() => createStablecoinBalanceState()))

const createWalletRequestMock = (
  response: string = '0x-minipay-transaction',
): NonNullable<IWallet['request']> => {
  const requestMock = vi.fn(async (_request: WalletConnectRequest): Promise<string> => response)

  return async <TResult,>(request: WalletConnectRequest): Promise<TResult> => (
    await requestMock(request)
  ) as TResult
}

const mocked = vi.hoisted(() => {
  const abortResult = {
    error: {
      body: null,
      message: 'aborted',
      status: null,
      type: 'aborted',
    },
    headers: null,
    ok: false,
    status: null,
  } as const

  const requestQuoteMock = vi.fn((request: { amount: number }, opts?: { signal?: AbortSignal }) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        data: { quote_id: `q-${request.amount}`, value: request.amount * 2 },
        headers: new Headers(),
        ok: true,
        status: 200,
      })
    }, 50)
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve(abortResult)
    })
  }))

  const requestReverseQuoteMock = vi.fn(async () => ({
    data: { quote_id: 'reverse-quote', value: 5 },
    headers: new Headers(),
    ok: true,
    status: 200,
  }))

  const decodeQrCodeBRMock = vi.fn(async () => ({
    data: { decoded: {} },
    headers: new Headers(),
    ok: true,
    status: 200,
  }))

  const acceptTransactionRequestMock = vi.fn(async () => ({
    data: {
      id: 'tx-1', kycLink: null, payment_context: null, transaction_reference: 'ref',
    },
    headers: new Headers(),
    ok: true,
    status: 200,
  }))

  const fetchPublicCorridorsMock = vi.fn<[], Promise<PublicCorridorResponse>>(async () => ({
    corridors: [{
      blockchain: 'STELLAR',
      chainFamily: 'stellar',
      chainId: 'stellar:pubnet',
      cryptoCurrency: 'USDC',
      maxAmount: null,
      minAmount: null,
      notify: { endpoint: null, required: false },
      paymentMethod: 'BREB',
      targetCurrency: 'BRL',
      walletConnect: {
        chainId: 'stellar:pubnet',
        events: [],
        methods: ['stellar_signXDR'],
        namespace: 'stellar',
      },
    }],
  }))

  return {
    abortResult,
    acceptTransactionRequestMock,
    decodeQrCodeBRMock,
    fetchPublicCorridorsMock,
    requestQuoteMock,
    requestReverseQuoteMock,
  }
})

vi.mock('../api', () => ({
  _36EnumsTargetCurrency: { BRL: 'BRL', COP: 'COP' },
  decodeQrCodeBR: mocked.decodeQrCodeBRMock,
}))

vi.mock('../services/public/publicApi', () => ({
  acceptTransactionRequest: mocked.acceptTransactionRequestMock,
  fetchPublicCorridors: mocked.fetchPublicCorridorsMock,
  notifyPayment: vi.fn(),
  requestQuote: mocked.requestQuoteMock,
  requestReverseQuote: mocked.requestReverseQuoteMock,
}))

vi.mock('../features/swap/hooks/useStablecoinBalances', () => ({
  useStablecoinBalances: stablecoinBalancesMock,
}))

const mockKit: IWallet = {
  address: 'GADDR',
  chainId: 'stellar:pubnet',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'signed-xdr', signerAddress: 'GADDR' })),
  walletId: 'stellar-kit',
}

const mockWalletAuthentication: IWalletAuthentication = {
  authenticate: vi.fn(),
  getAuthToken: vi.fn(),
  getChallengeMessage: vi.fn(),
  jwtToken: 'token',
  refreshAuthToken: vi.fn(),
  setJwtToken: vi.fn(),
}

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <NoticeProvider>
    <WalletAuthContext.Provider value={{
      defaultWallet: mockKit,
      getWalletHandler: vi.fn(() => mockKit),
      kycUrl: null,
      miniPay: {
        isActive: false,
        isReady: false,
        isResolving: false,
        status: 'inactive' as const,
      },
      setActiveWallet: vi.fn(),
      setKycUrl: vi.fn(),
      wallet: mockKit,
      walletAuthentication: mockWalletAuthentication,
    }}
    >
      {children}
    </WalletAuthContext.Provider>
  </NoticeProvider>
)

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  stablecoinBalancesMock.mockReset()
  stablecoinBalancesMock.mockImplementation(() => createStablecoinBalanceState())
})

describe('useWebSwapController', () => {
  it('aborts stale quote requests', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.swapViewProps.onTargetChange('10')
      result.current.swapViewProps.onTargetChange('20')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(mocked.requestQuoteMock).toHaveBeenCalledTimes(2)
    expect(result.current.swapViewProps.sourceAmount).toBe('40')
    expect(result.current.swapViewProps.targetAmount).toBe('20')
  })

  it('auto-selects Stellar when SEP-24 token is present in URL', async () => {
    mocked.fetchPublicCorridorsMock.mockResolvedValueOnce({
      corridors: [{
        blockchain: 'BASE',
        chainFamily: 'evm',
        chainId: 'eip155:8453',
        cryptoCurrency: 'USDC',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: null, required: false },
        paymentMethod: 'BREB',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'eip155:8453',
          events: [],
          methods: ['eth_sendTransaction'],
          namespace: 'eip155',
        },
      }, {
        blockchain: 'STELLAR',
        chainFamily: 'stellar',
        chainId: 'stellar:pubnet',
        cryptoCurrency: 'USDC',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: null, required: false },
        paymentMethod: 'BREB',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'stellar:pubnet',
          events: [],
          methods: ['stellar_signXDR'],
          namespace: 'stellar',
        },
      }],
    })

    window.history.replaceState({}, '', '/?token=sep24-token&address=GADDR')

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    expect(result.current.swapViewProps.selectedChainLabel).toBe('Stellar')
  })

  it('does not advance confirm flow without amounts', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.confirmQrProps.onConfirm()
    })

    expect(result.current.view).toBe('swap')
  })

  it('requires only the BRE-B key when using COP payouts', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.selectCurrency('COP')
      result.current.bankDetailsProps.onAccountNumberChange('BREB-KEY-123456')
    })

    expect(result.current.bankDetailsProps.continueDisabled).toBe(false)
  })

  it('locks MiniPay mode to Celo corridors and prefers the highest supported stablecoin', async () => {
    const miniPayWallet: IWallet = {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 'eip155:42220',
      connect: vi.fn(),
      disconnect: vi.fn(),
      request: createWalletRequestMock(),
      signTransaction: vi.fn(async () => ({ signedTxXdr: 'unused', signerAddress: undefined })),
      walletId: 'mini-pay',
    }

    stablecoinBalancesMock.mockImplementation(() => createStablecoinBalanceState({
      cUsd: '40.00',
      highestBalanceToken: 'cUSD',
      preferredSupportedToken: 'USDT',
      preferenceKind: 'unsupported-preferred',
      usdc: '5.00',
      usdt: '22.00',
    }))

    mocked.fetchPublicCorridorsMock.mockResolvedValueOnce({
      corridors: [{
        blockchain: 'CELO',
        chainFamily: 'evm',
        chainId: 'eip155:42220',
        cryptoCurrency: 'USDC',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: '/payments/notify', required: true },
        paymentMethod: 'BREB',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'eip155:42220',
          events: [],
          methods: ['eth_sendTransaction'],
          namespace: 'eip155',
        },
      }, {
        blockchain: 'CELO',
        chainFamily: 'evm',
        chainId: 'eip155:42220',
        cryptoCurrency: 'USDT',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: '/payments/notify', required: true },
        paymentMethod: 'BREB',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'eip155:42220',
          events: [],
          methods: ['eth_sendTransaction'],
          namespace: 'eip155',
        },
      }, {
        blockchain: 'STELLAR',
        chainFamily: 'stellar',
        chainId: 'stellar:pubnet',
        cryptoCurrency: 'USDC',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: null, required: false },
        paymentMethod: 'BREB',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'stellar:pubnet',
          events: [],
          methods: ['stellar_signXDR'],
          namespace: 'stellar',
        },
      }],
    })

    const MiniPayWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <NoticeProvider>
        <WalletAuthContext.Provider value={{
          defaultWallet: miniPayWallet,
          getWalletHandler: vi.fn(() => miniPayWallet),
          kycUrl: null,
          miniPay: {
            isActive: true,
            isReady: true,
            isResolving: false,
            status: 'ready',
          },
          setActiveWallet: vi.fn(),
          setKycUrl: vi.fn(),
          wallet: miniPayWallet,
          walletAuthentication: {
            ...mockWalletAuthentication,
            jwtToken: null,
          },
        }}
        >
          {children}
        </WalletAuthContext.Provider>
      </NoticeProvider>
    )

    const { result } = renderHook(() => useWebSwapController(), { wrapper: MiniPayWrapper })

    await act(async () => {
      await Promise.resolve()
      const latestCall = mocked.fetchPublicCorridorsMock.mock.results[mocked.fetchPublicCorridorsMock.mock.results.length - 1]
      await latestCall?.value
    })

    expect(result.current.isMiniPay).toBe(true)
    expect(result.current.chainOptions).toHaveLength(1)
    expect(result.current.swapViewProps.selectedChainLabel).toBe('Celo')
    expect(result.current.swapViewProps.selectedAssetLabel).toBe('USDT')
    expect(result.current.swapViewProps.miniPayNotice?.title).toBe('Use USDC or USDT')
  })
})
