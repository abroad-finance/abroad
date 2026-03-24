import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { IWallet } from '../interfaces/IWallet'
import { WalletType } from '../interfaces/IWalletFactory'
import { sessionStore } from '../services/auth/sessionStore'
import { useWalletAuthentication } from '../services/useWalletAuthentication'
import { useWalletFactory } from '../services/useWalletFactory'
import { getWalletTypeByDevice } from '../shared/utils'
import { WalletAuthContext } from './WalletAuthContext'

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [kycUrl, _setKycUrl] = useState<null | string>(() => localStorage.getItem('kycUrl'))
  const [initialized, setInitialized] = useState(false)
  const walletAuthentication = useWalletAuthentication()
  const walletFactory = useWalletFactory({ walletAuth: walletAuthentication })

  // Reconnect wallet from saved session on mount
  useEffect(() => {
    const restoreSession = async () => {
      const session = sessionStore.get()
      if (session && session.address && session.walletId) {
        try {
          // Validate walletId against WalletType enum
          const validWalletTypes: WalletType[] = [
            'mini-pay',
            'sep24',
            'stellar-kit',
            'wallet-connect',
          ]
          if (!validWalletTypes.includes(session.walletId as WalletType)) {
            // Invalid walletId in session, clear it
            sessionStore.clear()
            setInitialized(true)
            return
          }

          // Get the wallet handler for the saved wallet
          const savedWallet = walletFactory.getWalletHandler(session.walletId as WalletType)
          if (savedWallet && savedWallet.connect) {
            // Reconnect the wallet with saved session data
            await savedWallet.connect({
              chainId: session.chainId,
            })
          }
        }
        catch (err) {
          // If reconnection fails, clear the session
          if (import.meta.env.DEV) {
            console.error('Failed to restore wallet session', err)
          }
          sessionStore.clear()
        }
      }
      setInitialized(true)
    }

    restoreSession()
  }, [walletFactory])

  const defaultWallet = useMemo<IWallet | undefined>(() => {
    if (!initialized) {
      return undefined
    }
    if (walletFactory.miniPay.isActive) {
      return walletFactory.getWalletHandler('mini-pay')
    }

    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('token')) {
      // If there's a token in the URL, force using sep24 wallet to handle it.
      return walletFactory.getWalletHandler('sep24')
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

  const setKycUrl = useCallback((url: null | string) => {
    _setKycUrl(url)
    if (url) {
      localStorage.setItem('kycUrl', url)
    }
    else {
      localStorage.removeItem('kycUrl')
    }
  }, [])

  return (
    <WalletAuthContext.Provider value={{
      defaultWallet,
      getWalletHandler: walletFactory.getWalletHandler,
      kycUrl,
      miniPay: walletFactory.miniPay,
      setActiveWallet: setWallet,
      setKycUrl,
      wallet,
      walletAuthentication,
    }}
    >
      {children}
    </WalletAuthContext.Provider>
  )
}
