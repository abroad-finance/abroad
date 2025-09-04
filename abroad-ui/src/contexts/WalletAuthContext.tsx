import { WalletNetwork } from '@creit.tech/stellar-wallets-kit'
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

import { kit } from '../services/stellarKit'
import { refreshWalletAuthToken, walletAuth } from '../services/walletAuth'
import { PENDING_TX_KEY } from '../shared/constants'

interface WalletAuthState {
  address: null | string
  authenticateWithWallet: (walletId: string) => Promise<void>
  kycUrl: null | string
  logout: () => void
  setKycUrl: (url: string) => void
  token: null | string
  walletId: null | string
}

const WalletAuthContext = createContext<WalletAuthState>({
  address: null,
  authenticateWithWallet: async () => { },
  kycUrl: null,
  logout: () => { },
  setKycUrl: () => {}, token: null,
  walletId: null,
})

const signMessage = async (message: string): Promise<string> => {
  const response = await kit.signTransaction(message, { networkPassphrase: WalletNetwork.PUBLIC })
  return response.signedTxXdr
}
export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, _setToken] = useState<null | string>(() => localStorage.getItem('token'))
  const [kycUrl, _setKycUrl] = useState<null | string>(() => localStorage.getItem('kycUrl'))
  const [address, _setAddress] = useState<null | string>(() => localStorage.getItem('address'))
  const [walletId, _setWalletId] = useState<null | string>(() => localStorage.getItem('selectedWalletId'))

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

  const setAddress = useCallback((newAddress: null | string) => {
    _setAddress(newAddress)
    if (newAddress) {
      localStorage.setItem('address', newAddress)
    }
    else {
      localStorage.removeItem('address')
    }
  }, [])

  const setWalletId = useCallback((newWalletId: null | string) => {
    _setWalletId(newWalletId)

    if (newWalletId) {
      kit.setWallet(newWalletId)
      localStorage.setItem('selectedWalletId', newWalletId)
    }
    else {
      localStorage.removeItem('selectedWalletId')
    }
  }, [])

  const authenticateWithWallet = useCallback(async (walletId: string) => {
    if (
      !token
    ) {
      try {
        setWalletId(walletId)

        const { address } = await kit.getAddress()
        const newToken = await walletAuth(address, {
          signMessage,
        })

        setToken(newToken)
        setAddress(address)
      }
      catch (err) {
        console.trace('Wallet authentication failed', err)
      }
    }
  }, [
    setAddress,
    setToken,
    setWalletId,
    token,
  ])

  const logout = useCallback(() => {
    setToken(null)
    setAddress(null)
    setWalletId(null)
    setKycUrl(null)
    localStorage.removeItem(PENDING_TX_KEY)
    kit.disconnect()
  }, [
    setAddress,
    setKycUrl,
    setToken,
    setWalletId,
  ])

  const refreshToken = useCallback(async () => {
    if (!token) return
    try {
      const newToken = await refreshWalletAuthToken(token)
      setToken(newToken)
    }
    catch (err) {
      console.error('Failed to refresh wallet token', err)
      logout()
    }
  }, [
    logout,
    setToken,
    token,
  ])

  useEffect(() => {
    if (!walletId) {
      logout()
      return
    }
    try {
      kit.setWallet(walletId)
    }
    catch (err) {
      console.error('Failed to set wallet', err)
      logout()
    }
  }, [walletId, logout])

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
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    const address = urlParams.get('address')
    if (urlToken && address) {
      setToken(urlToken)
      setAddress(address)
      localStorage.setItem('token', urlToken)
      localStorage.setItem('address', address)
      urlParams.delete('token')
      urlParams.delete('address')
      window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`)
    }
  }, [setAddress, setToken])

  return (
    <WalletAuthContext.Provider value={{ address, authenticateWithWallet, kycUrl, logout, setKycUrl, token, walletId }}>
      {children}
    </WalletAuthContext.Provider>
  )
}

export const useWalletAuth = () => useContext(WalletAuthContext)
