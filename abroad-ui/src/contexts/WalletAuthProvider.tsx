import React, { useCallback, useMemo, useState } from 'react'

import { useWalletAuthentication } from '../services/useWalletAuthentication'
import { useWalletFactory } from '../services/useWalletFactory'
import { getWalletTypeByDevice } from '../shared/utils'
import { WalletAuthContext } from './WalletAuthContext'

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // TODO: implement persitent sessions
  const [kycUrl, _setKycUrl] = useState<null | string>(() => localStorage.getItem('kycUrl'))
  const walletAuthentication = useWalletAuthentication()
  const walletFactory = useWalletFactory({ walletAuth: walletAuthentication })
  const kit = useMemo(() => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('token')) {
      // If there's a token in the URL, force using sep24 wallet to handle it.
      return walletFactory.getWalletHandler('sep24')
    }

    const walletType = getWalletTypeByDevice()
    return walletFactory.getWalletHandler(walletType)
  }, [walletFactory])

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
      kit,
      kycUrl,
      setKycUrl,
      walletAuthentication,
    }}
    >
      {children}
    </WalletAuthContext.Provider>
  )
}
