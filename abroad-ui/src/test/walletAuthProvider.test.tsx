import {
  act, render, screen, waitFor,
} from '@testing-library/react'
import React from 'react'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import type { IWallet, WalletConnectOptions } from '../interfaces/IWallet'
import type { IWalletFactory } from '../interfaces/IWalletFactory'

import { WalletAuthProvider } from '../contexts/WalletAuthProvider'
import { authTokenStore } from '../services/auth/authTokenStore'
import { sessionStore } from '../services/auth/sessionStore'
import { useWalletAuth } from '../shared/hooks/useWalletAuth'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  connect: vi.fn<[options?: WalletConnectOptions], Promise<void>>(),
  getAuthToken: vi.fn(),
  getChallengeMessage: vi.fn(),
  getFactory: vi.fn(),
  onTokenChange: vi.fn(),
  refreshAuthToken: vi.fn(),
  setJwtToken: vi.fn(),
}))

vi.mock('../services/useWalletAuthentication', () => ({
  useWalletAuthentication: () => ({
    authenticate: mocks.authenticate,
    getAuthToken: mocks.getAuthToken,
    getChallengeMessage: mocks.getChallengeMessage,
    jwtToken: null,
    onTokenChange: mocks.onTokenChange,
    refreshAuthToken: mocks.refreshAuthToken,
    setJwtToken: mocks.setJwtToken,
  }),
}))

vi.mock('../services/useWalletFactory', () => ({
  useWalletFactory: () => mocks.getFactory(),
}))

const VALID_STELLAR_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ'

const createWallet = (): IWallet => ({
  address: null,
  chainId: 'stellar:pubnet',
  connect: mocks.connect,
  disconnect: vi.fn().mockResolvedValue(undefined),
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'signed' }),
  walletId: 'stellar-kit',
})

const createFactory = (): IWalletFactory => {
  const wallet = createWallet()
  return {
    getWalletHandler: () => wallet,
    miniPay: {
      isActive: false,
      isReady: false,
      isResolving: false,
      status: 'inactive',
    },
  }
}

const ProviderProbe = (): React.JSX.Element => {
  const { defaultWallet } = useWalletAuth()
  return <div data-testid="wallet-provider-state">{defaultWallet?.walletId ?? 'initializing'}</div>
}

describe('WalletAuthProvider', () => {
  let currentFactory: IWalletFactory

  beforeEach(() => {
    localStorage.clear()
    authTokenStore.setToken(null)
    vi.clearAllMocks()
    currentFactory = createFactory()
    mocks.getFactory.mockImplementation(() => currentFactory)
  })

  it('starts at most one restoration while wallet factory identity changes', async () => {
    sessionStore.set({
      address: VALID_STELLAR_ADDRESS,
      chainId: 'stellar:pubnet',
      walletId: 'stellar-kit',
    })

    let completeRestore: (() => void) | undefined
    const restorePromise = new Promise<void>((resolve) => {
      completeRestore = resolve
    })
    mocks.connect.mockReturnValue(restorePromise)

    const view = render(
      <WalletAuthProvider><ProviderProbe /></WalletAuthProvider>,
    )

    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1))

    currentFactory = createFactory()
    view.rerender(
      <WalletAuthProvider><ProviderProbe /></WalletAuthProvider>,
    )

    try {
      await act(async () => Promise.resolve())
      expect(mocks.connect).toHaveBeenCalledTimes(1)
    }
    finally {
      await act(async () => completeRestore?.())
    }
  })

  it('clears an invalid persisted session without connecting it', async () => {
    sessionStore.set({
      address: 'not-a-stellar-address',
      chainId: 'stellar:pubnet',
      walletId: 'stellar-kit',
    })
    mocks.connect.mockResolvedValue(undefined)

    render(
      <WalletAuthProvider><ProviderProbe /></WalletAuthProvider>,
    )

    await screen.findByText('stellar-kit')

    expect(mocks.connect).not.toHaveBeenCalled()
    expect(sessionStore.get()).toBeNull()
  })
})
