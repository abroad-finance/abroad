import { useSyncExternalStore } from 'react'

export type OpsAuthState = {
  error: null | string
  legacyApiKey: null | string
  session: null | OpsSession
  status: OpsAuthStatus
}

export type OpsAuthStatus = 'authenticated' | 'authenticating' | 'error' | 'initializing' | 'signed_out'

export type OpsSession = {
  authenticatedAt: null | string
  bootstrapRequired: boolean
  displayName: string
  email: null | string
  kind: 'ops_legacy' | 'ops_user'
  permissions: string[]
  role: null | string
  sessionVersion: null | number
  stepUpExpiresAt: null | string
  userId: null | string
}

let state: OpsAuthState = {
  error: null,
  legacyApiKey: null,
  session: null,
  status: 'initializing',
}

const listeners = new Set<() => void>()

const notify = (): void => {
  listeners.forEach(listener => listener())
}

const replaceState = (next: OpsAuthState): void => {
  if (Object.is(next, state)) return
  state = next
  notify()
}

export const getOpsAuthState = (): OpsAuthState => state

export const setOpsAuthStatus = (
  status: OpsAuthStatus,
  error: null | string = null,
): void => {
  replaceState({ ...state, error, status })
}

export const setOpsSession = (session: null | OpsSession): void => {
  replaceState({
    ...state,
    error: null,
    session,
    status: session ? 'authenticated' : 'signed_out',
  })
}

export const getOpsSession = (): null | OpsSession => state.session

export const getOpsApiKey = (): null | string => state.legacyApiKey

export const setOpsApiKey = (value: null | string): void => {
  const legacyApiKey = value?.trim() || null
  if (legacyApiKey === state.legacyApiKey) return
  replaceState({ ...state, legacyApiKey })
}

export const clearOpsApiKey = (): void => {
  if (!state.legacyApiKey) return
  replaceState({ ...state, legacyApiKey: null })
}

export const subscribeOpsAuth = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useOpsAuth = (): OpsAuthState => (
  useSyncExternalStore(subscribeOpsAuth, getOpsAuthState, getOpsAuthState)
)

/**
 * Compatibility hook for existing page load guards. The returned marker is
 * never sent over the network; request authentication is resolved by
 * `getOpsCredentialHeaders` using the current Firebase user first.
 */
export const useOpsApiKey = (): null | string => {
  const auth = useOpsAuth()
  return auth.legacyApiKey ?? (auth.session ? '__named_ops_session__' : null)
}

export const useOpsSession = (): null | OpsSession => useOpsAuth().session

export const useOpsIsAuthenticated = (): boolean => {
  const auth = useOpsAuth()
  return Boolean(auth.session || auth.legacyApiKey)
}
