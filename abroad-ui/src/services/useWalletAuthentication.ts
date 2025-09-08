import { useCallback, useEffect, useState } from 'react'

import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import { challenge, refresh, verify } from '../api'

export const useWalletAuthentication = (): IWalletAuthentication => {
  const [jwtToken, _setJwtToken] = useState<null | string>(null)

  const setJwtToken = useCallback((token: null | string) => {
    localStorage.setItem('token', token ?? '')
    _setJwtToken(token)
  }, [])

  const getAuthToken = useCallback(async ({ address, signedMessage }: { address: string, signedMessage: string }): Promise<{ token: string }> => {
    const res = await verify({ address, signedXDR: signedMessage })
    if (res.status !== 200) throw new Error('Failed to verify signature')
    return { token: res.data.token }
  }, [])

  const getChallengeMessage = useCallback(async ({ address }: { address: string }): Promise<{ message: string }> => {
    const res = await challenge({ address })
    if (res.status !== 200) throw new Error('Failed to fetch challenge')
    return { message: res.data.xdr }
  }, [])

  const refreshAuthToken = useCallback(async ({ token }: { token: string }): Promise<{ token: string }> => {
    const res = await refresh({ token })
    if (res.status !== 200) throw new Error('Failed to refresh token')
    return { token: res.data.token }
  }, [])

  const refreshToken = useCallback(async () => {
    if (!jwtToken) return
    try {
      const { token: newToken } = await refreshAuthToken({ token: jwtToken })
      setJwtToken(newToken)
    }
    catch (err) {
      console.error('Failed to refresh wallet token', err)
    }
  }, [
    jwtToken,
    refreshAuthToken,
    setJwtToken,
  ])

  useEffect(() => {
    if (!jwtToken) {
      return
    }
    const payload = JSON.parse(atob(jwtToken.split('.')[1])) as { exp?: number }
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
  }, [jwtToken, refreshToken])

  return {
    getAuthToken,
    getChallengeMessage,
    jwtToken,
    refreshAuthToken,
    setJwtToken,
  }
}
