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
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import { NoticeProvider } from '../contexts/NoticeContext'
import { WalletAuthContext } from '../contexts/WalletAuthContext'
import { useWebSwapController } from '../pages/WebSwap/useWebSwapController'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

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

  const fetchPublicCorridorsMock = vi.fn(async () => ({
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
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
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

  it('does not advance confirm flow without amounts', () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    act(() => {
      result.current.confirmQrProps.onConfirm()
    })

    expect(result.current.view).toBe('swap')
  })

  it('requires only the BRE-B key when using COP payouts', () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    act(() => {
      result.current.swapViewProps.selectCurrency('COP')
      result.current.bankDetailsProps.onAccountNumberChange('BREB-KEY-123456')
    })

    expect(result.current.bankDetailsProps.continueDisabled).toBe(false)
  })
})
