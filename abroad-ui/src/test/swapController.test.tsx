import { act, renderHook, waitFor } from '@testing-library/react'
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

const getQuoteMock = vi.fn((request: { amount: number }, opts?: { signal?: AbortSignal }) => new Promise((resolve) => {
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

const getReverseQuoteMock = vi.fn(async () => ({
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

const acceptTransactionMock = vi.fn(async () => ({
  data: { id: 'tx-1', kycLink: null, transaction_reference: 'ref' },
  headers: new Headers(),
  ok: true,
  status: 200,
}))

const getBanksMock = vi.fn(async () => ({
  data: { banks: [] },
  headers: new Headers(),
  ok: true,
  status: 200,
}))

vi.mock('../api', () => ({
  _36EnumsBlockchainNetwork: { STELLAR: 'STELLAR' },
  _36EnumsCryptoCurrency: { USDC: 'USDC' },
  _36EnumsPaymentMethod: { BREB: 'BREB', PIX: 'PIX' },
  _36EnumsTargetCurrency: { BRL: 'BRL', COP: 'COP' },
  acceptTransaction: (...args: unknown[]) => acceptTransactionMock(...args),
  decodeQrCodeBR: (...args: unknown[]) => decodeQrCodeBRMock(...args),
  getBanks: (...args: unknown[]) => getBanksMock(...args),
  getQuote: (...args: unknown[]) => getQuoteMock(...args),
  getReverseQuote: (...args: unknown[]) => getReverseQuoteMock(...args),
}))

const mockKit: IWallet = {
  address: 'GADDR',
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
      kit: mockKit,
      kycUrl: null,
      setKycUrl: vi.fn(),
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

    act(() => {
      result.current.swapViewProps.onTargetChange('10')
      result.current.swapViewProps.onTargetChange('20')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(getQuoteMock).toHaveBeenCalledTimes(2)
    expect(result.current.swapViewProps.sourceAmount).toBe('40.00')
    expect(result.current.swapViewProps.targetAmount).toBe('20')
  })

  it('does not advance confirm flow without amounts', () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    act(() => {
      result.current.confirmQrProps.onConfirm()
    })

    expect(result.current.view).toBe('swap')
  })

  it('requests BreB rails when quoting to COP', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      result.current.swapViewProps.selectCurrency('COP')
      await Promise.resolve()
    })

    await act(async () => {
      result.current.swapViewProps.onTargetChange('15')
      vi.runAllTimers()
    })

    await waitFor(() => {
      expect(getBanksMock).toHaveBeenCalledWith(
        { paymentMethod: 'BREB' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(getQuoteMock).toHaveBeenCalledWith(
        expect.objectContaining({ payment_method: 'BREB' }),
        expect.anything(),
      )
    })
  })

  it('does not require selecting a bank when using BreB', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      result.current.swapViewProps.selectCurrency('COP')
      result.current.bankDetailsProps.onAccountNumberChange('1234567890')
    })

    await waitFor(() => {
      expect(result.current.bankDetailsProps.continueDisabled).toBe(false)
    })
  })
})
