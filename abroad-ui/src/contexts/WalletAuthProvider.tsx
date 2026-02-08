import React, { useCallback, useMemo, useState } from 'react'

import type { WalletType } from '../interfaces/IWalletFactory'

import { useWalletAuthentication } from '../services/useWalletAuthentication'
import { useWalletFactory } from '../services/useWalletFactory'
import { getWalletTypeByDevice } from '../shared/utils'
import { WalletAuthContext } from './WalletAuthContext'

const WALLET_TYPE_KEY = 'abroad:walletType'

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [kycUrl, _setKycUrl] = useState<null | string>(() => localStorage.getItem('kycUrl'))
  const walletAuthentication = useWalletAuthentication()
  const walletFactory = useWalletFactory({ walletAuth: walletAuthentication })
  const defaultWallet = useMemo(() => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('token')) {
      return walletFactory.getWalletHandler('sep24')
    }

    // Restore persisted wallet type, or fall back to device default
    const persisted = localStorage.getItem(WALLET_TYPE_KEY) as WalletType | null
    const walletType = persisted || getWalletTypeByDevice()
    return walletFactory.getWalletHandler(walletType)
  }, [walletFactory])
  const [wallet, _setWallet] = useState(defaultWallet)

  const setWallet = useCallback((w: typeof defaultWallet) => {
    _setWallet(w)
    // Persist the wallet type so it survives page refresh
    if (w.walletId === 'wallet-connect') {
      localStorage.setItem(WALLET_TYPE_KEY, 'wallet-connect')
    }
    else {
      localStorage.setItem(WALLET_TYPE_KEY, 'stellar-kit')
    }
  }, [])

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
