import {
  useCallback, useEffect, useRef, useState,
} from 'react'

import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type { ApiResult } from './http/types'

import { authTokenStore } from './auth/authTokenStore'
import { httpClient } from './http/httpClient'

const REFRESH_GRACE_MS = 60_000

type ChallengeResponse = {
  format?: 'utf8' | 'xdr'
  message?: string
  xdr?: string
}

type JwtPayload = { exp?: number }

type RefreshResponse = { token: string }

type VerifyResponse = { token: string }

type WalletAuthError = {
  reason?: string
}

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

const buildJsonRequest = async <TData, TError = WalletAuthError>(path: string, payload: unknown): Promise<ApiResult<TData, TError>> => {
  return httpClient.request(path, {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
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
    const res = await buildJsonRequest<RefreshResponse>('/walletAuth/refresh', { token })
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

  const getChallengeMessage = useCallback(async ({ address, chainId }: { address: string, chainId: string }): Promise<{ message: string }> => {
    const res = await buildJsonRequest<ChallengeResponse>('/walletAuth/challenge', { address, chainId })
    const data = ensureOk(res, 'Failed to fetch challenge')
    const message = data.message ?? data.xdr
    if (!message) {
      throw new Error('Invalid challenge response')
    }
    return { message }
  }, [])

  const getAuthToken = useCallback(async ({ address, chainId, signedMessage }: {
    address: string
    chainId: string
    signedMessage: string
  }): Promise<{ token: string }> => {
    const payload = chainId.startsWith('stellar:')
      ? { address, chainId, signedXDR: signedMessage }
      : { address, chainId, signature: signedMessage }
    const res = await buildJsonRequest<VerifyResponse>('/walletAuth/verify', payload)
    const data = ensureOk(res, 'Failed to verify signature')
    return { token: data.token }
  }, [])

  const authenticate = useCallback(async ({ address, chainId, signMessage }: {
    address: string
    chainId: string
    signMessage: (message: string) => Promise<string>
  }) => {
    const { message } = await getChallengeMessage({ address, chainId })
    const signed = await signMessage(message)
    const { token } = await getAuthToken({ address, chainId, signedMessage: signed })
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
