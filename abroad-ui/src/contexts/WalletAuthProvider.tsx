import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { useWalletAuthentication } from '../services/useWalletAuthentication'
import { useWalletFactory } from '../services/useWalletFactory'
import { getWalletTypeByDevice } from '../shared/utils'
import { WalletAuthContext } from './WalletAuthContext'

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // TODO: implement persitent sessions
  const [token, _setToken] = useState<null | string>(null)
  const [kycUrl, _setKycUrl] = useState<null | string>(() => localStorage.getItem('kycUrl'))
  const walletAuthentication = useWalletAuthentication()
  const walletFactory = useWalletFactory({
    walletAuth: walletAuthentication,
  })
  const kit = useMemo(() => {
    const walletType = getWalletTypeByDevice()
    return walletFactory.getWalletHandler(walletType)
  }, [walletFactory])

  const setToken = useCallback((newToken: null | string) => {
    _setToken(newToken)
    if (newToken) {
      localStorage.setItem('token', newToken)
    }
    else {
      localStorage.removeItem('token')
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

  const authenticateWithWallet = useCallback(async () => {
    try {
      const { authToken } = await kit.connect()
      setToken(authToken)
      console.log('Wallet authenticated successfully')
    }
    catch (err) {
      console.trace('Wallet authentication failed', err)
    }
  }, [kit, setToken])

  const refreshToken = useCallback(async () => {
    if (!token) return
    try {
      const { token: newToken } = await walletAuthentication.refreshAuthToken({ token })
      setToken(newToken)
    }
    catch (err) {
      console.error('Failed to refresh wallet token', err)
      kit.disconnect()
    }
  }, [
    kit,
    setToken,
    token,
    walletAuthentication,
  ])

  useEffect(() => {
    if (!token) {
      return
    }
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number }
    if (!payload.exp) {
      return
    }
    const timeout = payload.exp * 1000 - Date.now() - 60000
    if (timeout <= 0) {
      refreshToken()
      return
    }
    const id = setTimeout(refreshToken, timeout)
    return () => clearTimeout(id)
  }, [refreshToken, token])

  // at mount check the url params for token
  // TODO: implement wallet handler for sep24

  return (
    <WalletAuthContext.Provider value={{ authenticateWithWallet, kit, kycUrl, setKycUrl, token }}>
      {children}
    </WalletAuthContext.Provider>
  )
}
