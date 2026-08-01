import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import { sessionStore } from '../services/auth/sessionStore'
import { commitAuthenticatedWallet } from '../services/wallets/shared/authenticated-wallet-session'

const SESSION = {
  address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  chainId: 'stellar:pubnet',
  walletId: 'stellar-kit',
} as const

describe('commitAuthenticatedWallet', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('publishes and persists the wallet only after authentication succeeds', async () => {
    let completeAuthentication: (() => void) | undefined
    const authentication = new Promise<void>((resolve) => {
      completeAuthentication = resolve
    })
    const onCommitted = vi.fn()

    const commit = commitAuthenticatedWallet({
      authenticate: () => authentication,
      onCommitted,
      session: SESSION,
    })

    expect(onCommitted).not.toHaveBeenCalled()
    expect(sessionStore.get()).toBeNull()

    completeAuthentication?.()
    await commit

    expect(sessionStore.get()).toMatchObject(SESSION)
    expect(onCommitted).toHaveBeenCalledTimes(1)
  })

  it('does not publish or persist a wallet when authentication fails', async () => {
    const onCommitted = vi.fn()

    await expect(commitAuthenticatedWallet({
      authenticate: () => Promise.reject(new Error('signature rejected')),
      onCommitted,
      session: SESSION,
    })).rejects.toThrow('signature rejected')

    expect(onCommitted).not.toHaveBeenCalled()
    expect(sessionStore.get()).toBeNull()
  })
})
