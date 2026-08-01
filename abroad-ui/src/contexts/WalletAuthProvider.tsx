import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { IWallet } from '../interfaces/IWallet'
import { WalletType } from '../interfaces/IWalletFactory'
import { authTokenStore } from '../services/auth/authTokenStore'
import { sessionStore } from '../services/auth/sessionStore'
import { useWalletAuthentication } from '../services/useWalletAuthentication'
import { useWalletFactory } from '../services/useWalletFactory'
import { getWalletTypeByDevice } from '../shared/utils'
import { WalletAuthContext } from './WalletAuthContext'

const VALID_WALLET_TYPES: ReadonlySet<string> = new Set<WalletType>([
  'mini-pay',
  'sep24',
  'solana',
  'stellar-kit',
  'wallet-connect',
])

const isWalletType = (value: string): value is WalletType => VALID_WALLET_TYPES.has(value)

const resolveSessionWalletType = ({ chainId, walletId }: {
  chainId: string
  walletId: string
}): null | WalletType => {
  if (isWalletType(walletId)) {
    return walletId
  }
  // StellarKit persists the selected extension id (for example, Freighter)
  // so it can restore that module. Those legacy sessions still belong to the
  // StellarKit wallet surface.
  if (chainId.startsWith('stellar:')) {
    return 'stellar-kit'
  }
  return null
}

const isStoredTokenValid = (): boolean => {
  const token = authTokenStore.getToken()
  if (!token) return false
  try {
    const [, payload] = token.split('.')
    if (!payload) return false
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - payload.length % 4) % 4)
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof decoded.exp === 'number' && decoded.exp * 1000 > Date.now()
  }
  catch {
    return false
  }
}

const restoreWalletSession = async (walletFactory: ReturnType<typeof useWalletFactory>): Promise<void> => {
  const session = sessionStore.get()
  if (!session) return
  if (!sessionStore.isValid()) {
    sessionStore.clear()
    return
  }

  const walletType = resolveSessionWalletType(session)
  if (!walletType) {
    sessionStore.clear()
    return
  }

  try {
    const savedWallet = walletFactory.getWalletHandler(walletType)
    if (isStoredTokenValid() && savedWallet.address && savedWallet.chainId) {
      return
    }
    await savedWallet.connect({ chainId: session.chainId })
  }
  catch (error) {
    if (import.meta.env.DEV) {
      console.error('Failed to restore wallet session', error)
    }
    sessionStore.clear()
  }
}

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialized, setInitialized] = useState(false)
  const walletAuthentication = useWalletAuthentication()
  const walletFactory = useWalletFactory({ walletAuth: walletAuthentication })
  const restorePromiseRef = useRef<null | Promise<void>>(null)

  // Restore wallet session on mount (reconnect if needed)
  useEffect(() => {
    if (!restorePromiseRef.current) {
      restorePromiseRef.current = restoreWalletSession(walletFactory)
    }

    let subscribed = true
    void restorePromiseRef.current.finally(() => {
      if (subscribed) setInitialized(true)
    })
    return () => {
      subscribed = false
    }
  }, [walletFactory])

  const defaultWallet = useMemo<IWallet | undefined>(() => {
    if (!initialized) {
      return undefined
    }

    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('token')) {
      // If there's a token in the URL, force using sep24 wallet to handle it.
      return walletFactory.getWalletHandler('sep24')
    }

    // Prioritize saved session over MiniPay and device defaults
    const session = sessionStore.get()
    const sessionWalletType = session && sessionStore.isValid()
      ? resolveSessionWalletType(session)
      : null
    if (sessionWalletType) {
      return walletFactory.getWalletHandler(sessionWalletType)
    }

    // Only use MiniPay as default if no saved session exists
    if (walletFactory.miniPay.isActive) {
      return walletFactory.getWalletHandler('mini-pay')
    }

    const walletType = getWalletTypeByDevice()
    return walletFactory.getWalletHandler(walletType)
  }, [walletFactory, initialized])
  const [wallet, setWallet] = useState<IWallet | undefined>(defaultWallet)

  useEffect(() => {
    if (defaultWallet) {
      setWallet(defaultWallet)
    }
  }, [defaultWallet])

  useEffect(() => {
    if (!walletFactory.miniPay.isActive || !walletAuthentication.jwtToken) {
      return
    }
    walletAuthentication.setJwtToken(null)
  }, [
    walletAuthentication,
    walletAuthentication.jwtToken,
    walletFactory.miniPay.isActive,
  ])

  return (
    <WalletAuthContext.Provider value={{
      defaultWallet,
      getWalletHandler: walletFactory.getWalletHandler,
      miniPay: walletFactory.miniPay,
      setActiveWallet: setWallet,
      wallet,
      walletAuthentication,
    }}
    >
      {children}
    </WalletAuthContext.Provider>
  )
}
