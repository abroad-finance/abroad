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

import { WalletAuthContext } from '../contexts/WalletAuthContext'
import { useWalletDetails } from '../features/swap/hooks/useWalletDetails'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

vi.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: vi.fn(() => ({ loadAccount: vi.fn(async () => ({ balances: [] })) })) },
}))

vi.mock('../contexts/WebSocketContext', () => ({
  useWebSocketSubscription: () => undefined,
}))

const abortedPages: number[] = []

const mocked = vi.hoisted(() => ({
  listPartnerTransactionsMock: vi.fn((params: { page: number }, opts?: { signal?: AbortSignal }) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({
      data: {
        page: params.page,
        pageSize: 10,
        total: 0,
        transactions: [],
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    }), 50)
    opts?.signal?.addEventListener('abort', () => {
      abortedPages.push(params.page)
      clearTimeout(timer)
      resolve({
        error: {
          body: null, message: 'aborted', status: null, type: 'aborted',
        },
        headers: null,
        ok: false,
        status: null,
      })
    })
  })),
}))

vi.mock('../api', () => ({
  _36EnumsBlockchainNetwork: { STELLAR: 'STELLAR' },
  listPartnerTransactions: mocked.listPartnerTransactionsMock,
}))

const mockKit: IWallet = {
  address: 'GADDR',
  chainId: 'stellar:pubnet',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'xdr', signerAddress: 'GADDR' })),
  walletId: 'stellar-kit',
}

const mockAuth: IWalletAuthentication = {
  authenticate: vi.fn(),
  getAuthToken: vi.fn(),
  getChallengeMessage: vi.fn(),
  jwtToken: 'token',
  refreshAuthToken: vi.fn(),
  setJwtToken: vi.fn(),
}

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <WalletAuthContext.Provider value={{
    kycUrl: null,
    setKycUrl: vi.fn(),
    wallet: mockKit,
    walletAuthentication: mockAuth,
  }}
  >
    {children}
  </WalletAuthContext.Provider>
)

beforeEach(() => {
  vi.useFakeTimers()
  abortedPages.length = 0
  mocked.listPartnerTransactionsMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useWalletDetails pagination', () => {
  it('aborts in-flight pagination requests on unmount', async () => {
    const { result, unmount } = renderHook(() => useWalletDetails(), { wrapper: Wrapper })

    act(() => {
      result.current.onRefreshTransactions()
    })

    act(() => {
      unmount()
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(mocked.listPartnerTransactionsMock).toHaveBeenCalled()
    expect(abortedPages.length).toBeGreaterThanOrEqual(1)
  })
})
