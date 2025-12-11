import {
  useCallback, useEffect, useRef, useState,
} from 'react'

import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import {
  challenge,
  ChallengeResult,
  refresh,
  RefreshResult,
  verify,
  VerifyResult,
} from '../api'
import { authTokenStore } from './auth/authTokenStore'

type JwtPayload = { exp?: number }

const REFRESH_GRACE_MS = 60_000

const extractReason = (body: unknown): null | string => {
  if (body && typeof body === 'object' && 'reason' in body) {
    const reason = (body as { reason?: unknown }).reason
    if (typeof reason === 'string') return reason
  }
  return null
}

const ensureOk = <TData, TError>(result: { data?: TData, error?: { body?: null | TError, message?: string }, ok: boolean }, fallbackMessage: string): TData => {
  if (result.ok && result.data !== undefined) return result.data
  const detail = result.error?.body ? extractReason(result.error.body) : null
  const message = detail || result.error?.message || fallbackMessage
  throw new Error(message)
}

const safeParseJwt = (token: string): JwtPayload => {
  try {
    const [, payload] = token.split('.')
    if (!payload) return {}
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = atob(normalized)
    return JSON.parse(decoded) as JwtPayload
  }
  catch {
    return {}
  }
}

export const useWalletAuthentication = (): IWalletAuthentication => {
  const [jwtToken, setTokenState] = useState<null | string>(() => authTokenStore.getToken())
  const refreshTimeoutRef = useRef<null | number>(null)

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current)
      refreshTimeoutRef.current = null
    }
  }, [])

  const setJwtToken = useCallback((token: null | string) => {
    setTokenState(token)
    authTokenStore.setToken(token)
  }, [])

  const refreshAuthToken = useCallback(async ({ token }: { token: string }): Promise<{ token: string }> => {
    const res: RefreshResult = await refresh({ token })
    const data = ensureOk(res, 'Failed to refresh token')
    return { token: data.token }
  }, [])

  const scheduleRefresh = useCallback((token: null | string) => {
    clearRefreshTimeout()
    if (!token) return
    const payload = safeParseJwt(token)
    if (!payload.exp) return
    const delay = payload.exp * 1000 - Date.now() - REFRESH_GRACE_MS
    const timeoutMs = Math.max(delay, 1000)
    refreshTimeoutRef.current = window.setTimeout(async () => {
      try {
        const { token: newToken } = await refreshAuthToken({ token })
        setJwtToken(newToken)
      }
      catch (err) {
        console.error('Failed to refresh wallet token', err)
        setJwtToken(null)
      }
    }, timeoutMs)
  }, [
    clearRefreshTimeout,
    refreshAuthToken,
    setJwtToken,
  ])

  useEffect(() => {
    scheduleRefresh(jwtToken)
    return clearRefreshTimeout
  }, [
    jwtToken,
    scheduleRefresh,
    clearRefreshTimeout,
  ])

  useEffect(() => {
    const unsubscribe = authTokenStore.subscribe(setTokenState)
    return unsubscribe
  }, [])

  const getChallengeMessage = useCallback(async ({ address }: { address: string }): Promise<{ message: string }> => {
    const res: ChallengeResult = await challenge({ address })
    const data = ensureOk(res, 'Failed to fetch challenge')
    return { message: data.xdr }
  }, [])

  const getAuthToken = useCallback(async ({ address, signedMessage }: {
    address: string
    signedMessage: string
  }): Promise<{ token: string }> => {
    const res: VerifyResult = await verify({
      address,
      signedXDR: signedMessage,
    })
    const data = ensureOk(res, 'Failed to verify signature')
    return { token: data.token }
  }, [])

  const authenticate = useCallback(async (address: string, signMessage: (message: string) => Promise<string>) => {
    const { message } = await getChallengeMessage({ address })
    const signedXdr = await signMessage(message)
    const { token } = await getAuthToken({ address, signedMessage: signedXdr })
    setJwtToken(token)
    return { token }
  }, [
    getAuthToken,
    getChallengeMessage,
    setJwtToken,
  ])

  return {
    authenticate,
    getAuthToken,
    getChallengeMessage,
    jwtToken,
    onTokenChange: authTokenStore.subscribe.bind(authTokenStore),
    refreshAuthToken,
    setJwtToken,
  }
}
