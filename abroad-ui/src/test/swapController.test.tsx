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
import type { WalletConnectRequest } from '../interfaces/IWallet'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type {
  AcceptTransactionRequest,
  PublicCorridorResponse,
} from '../services/public/types'

import { NoticeProvider } from '../contexts/NoticeContext'
import { WalletAuthContext } from '../contexts/WalletAuthContext'
import { useWebSwapController } from '../pages/WebSwap/useWebSwapController'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const createStablecoinBalanceState = (overrides?: Partial<{
  cUsd: string
  highestBalanceToken: 'cUSD' | 'USDC' | 'USDT'
  isLoading: boolean
  preferenceKind: 'empty' | 'supported' | 'unsupported-preferred'
  preferredSupportedToken: 'USDC' | 'USDT' | null
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
const pixCheckoutTelemetryMock = vi.hoisted(() => ({
  recordPixCheckoutEvent: vi.fn(),
}))

vi.mock('../observability/pixCheckoutTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../observability/pixCheckoutTelemetry')>()
  return {
    ...actual,
    recordPixCheckoutEvent: pixCheckoutTelemetryMock.recordPixCheckoutEvent,
  }
})

const createWalletRequestMock = (
  response: string = '0x-minipay-transaction',
): NonNullable<IWallet['request']> => {
  const requestMock = vi.fn(async (request: WalletConnectRequest): Promise<string> => {
    void request
    return response
  })

  // eslint-disable-next-line @stylistic/comma-dangle
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

  const acceptTransactionRequestMock = vi.fn(async (request: AcceptTransactionRequest) => {
    void request
    return {
      data: {
        id: 'tx-1', kycRequired: false, payment_context: null, transaction_reference: 'ref',
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    }
  })

  const fetchPublicCorridorsMock = vi.fn<[], Promise<PublicCorridorResponse>>(async () => ({
    corridors: [{
      blockchain: 'STELLAR',
      chainFamily: 'stellar',
      chainId: 'stellar:pubnet',
      cryptoCurrency: 'USDC',
      maxAmount: null,
      minAmount: null,
      notify: { endpoint: null, required: false },
      paymentMethod: 'PIX',
      targetCurrency: 'BRL',
      walletConnect: {
        chainId: 'stellar:pubnet',
        events: [],
        methods: ['stellar_signXDR'],
        namespace: 'stellar',
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
      targetCurrency: 'COP',
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
      miniPay: {
        isActive: false,
        isReady: false,
        isResolving: false,
        status: 'inactive' as const,
      },
      setActiveWallet: vi.fn(),
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
  it('opens the PIX surface in the requested entry mode', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => result.current.openQr('paste'))

    expect(result.current.isQrOpen).toBe(true)
    expect(result.current.qrEntryMode).toBe('paste')

    act(() => result.current.closeQr())
    expect(result.current.isQrOpen).toBe(false)

    act(() => result.current.openQr('camera'))
    expect(result.current.qrEntryMode).toBe('camera')

    act(() => result.current.openQr('upload'))
    expect(result.current.qrEntryMode).toBe('upload')
  })

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
        paymentMethod: 'PIX',
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
        paymentMethod: 'PIX',
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

    expect(result.current.selectedChainKey).toContain('stellar')
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

  it('submits a valid BRL PIX quote through the transaction API after confirmation', async () => {
    mocked.acceptTransactionRequestMock.mockResolvedValueOnce({
      data: {
        id: 'accepted-pix-transaction',
        kycRequired: true,
        payment_context: null,
        transaction_reference: 'accepted-reference',
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('test-pix-key')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(mocked.requestQuoteMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        amount: 5,
        payment_method: 'PIX',
        target_currency: 'BRL',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.swapViewProps.continueDisabled).toBe(false)
    expect(result.current.swapViewProps.hasInsufficientFunds).toBe(false)

    await act(async () => {
      await result.current.swapViewProps.onPrimaryAction()
    })

    expect(result.current.view).toBe('confirm-qr')

    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledTimes(1)
    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      account_number: 'test-pix-key',
      qr_code: null,
      quote_id: 'q-5',
    }))
    expect(mocked.acceptTransactionRequestMock.mock.calls[0]?.[0]).not.toHaveProperty('tax_id')
    expect(result.current.view).toBe('kyc-needed')
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'quote_ready' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'checkout_ready' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'confirmation_viewed' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'submission_started' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'submission_accepted' }),
    )
    const telemetryJson = JSON.stringify(pixCheckoutTelemetryMock.recordPixCheckoutEvent.mock.calls)
    expect(telemetryJson).not.toContain('test-pix-key')
    expect(telemetryJson).not.toContain('tax_id')
    expect(telemetryJson).not.toContain('q-5')
    expect(telemetryJson).not.toContain('GADDR')
    expect(telemetryJson).not.toContain('accepted-pix-transaction')
    expect(telemetryJson).not.toContain('accepted-reference')
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

  it('keeps the current entry surface while switching target countries', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    const onboardingRates = result.current.onboardingRates

    act(() => result.current.selectCurrency('COP'))
    expect(result.current.targetCurrency).toBe('COP')
    expect(result.current.view).toBe('home')
    expect(result.current.onboardingRates).toBe(onboardingRates)

    act(() => result.current.goToManual())
    expect(result.current.view).toBe('swap')

    act(() => result.current.selectCurrency('BRL'))
    expect(result.current.targetCurrency).toBe('BRL')
    expect(result.current.swapViewProps.targetCurrency).toBe('BRL')
    expect(result.current.view).toBe('swap')
    expect(result.current.onboardingRates).toBe(onboardingRates)

    act(() => result.current.selectCurrency('COP'))
    expect(result.current.targetCurrency).toBe('COP')
    expect(result.current.swapViewProps.targetCurrency).toBe('COP')
    expect(result.current.view).toBe('swap')
    expect(result.current.onboardingRates).toBe(onboardingRates)
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
      preferenceKind: 'unsupported-preferred',
      preferredSupportedToken: 'USDT',
      usdc: '5.00',
      usdt: '22.00',
    }))

    mocked.fetchPublicCorridorsMock.mockResolvedValueOnce({
      corridors: [
        {
          blockchain: 'CELO',
          chainFamily: 'evm',
          chainId: 'eip155:42220',
          cryptoCurrency: 'USDC',
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: '/payments/notify', required: true },
          paymentMethod: 'PIX',
          targetCurrency: 'BRL',
          walletConnect: {
            chainId: 'eip155:42220',
            events: [],
            methods: ['eth_sendTransaction'],
            namespace: 'eip155',
          },
        },
        {
          blockchain: 'CELO',
          chainFamily: 'evm',
          chainId: 'eip155:42220',
          cryptoCurrency: 'USDT',
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: '/payments/notify', required: true },
          paymentMethod: 'PIX',
          targetCurrency: 'BRL',
          walletConnect: {
            chainId: 'eip155:42220',
            events: [],
            methods: ['eth_sendTransaction'],
            namespace: 'eip155',
          },
        },
        {
          blockchain: 'STELLAR',
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: 'USDC',
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: null, required: false },
          paymentMethod: 'PIX',
          targetCurrency: 'BRL',
          walletConnect: {
            chainId: 'stellar:pubnet',
            events: [],
            methods: ['stellar_signXDR'],
            namespace: 'stellar',
          },
        },
      ],
    })

    const MiniPayWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <NoticeProvider>
        <WalletAuthContext.Provider value={{
          defaultWallet: miniPayWallet,
          getWalletHandler: vi.fn(() => miniPayWallet),
          miniPay: {
            isActive: true,
            isReady: true,
            isResolving: false,
            status: 'ready',
          },
          setActiveWallet: vi.fn(),
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
    expect(result.current.swapViewProps.selectedAssetLabel).toBe('USDT')
    expect(result.current.swapViewProps.miniPayNotice?.title).toBe('Use USDC or USDT')
  })
})
