import { useSyncExternalStore } from 'react'

import type { PartnerPortalSession } from './partnerPortalTypes'

const STORAGE_KEY = 'abroad.partnerPortal.session.v1'
const listeners = new Set<() => void>()

const isSession = (value: unknown): value is PartnerPortalSession => {
  if (typeof value !== 'object' || value === null) return false
  return (
    'accessToken' in value
    && typeof value.accessToken === 'string'
    && value.accessToken.trim().length > 0
    && 'expiresAt' in value
    && typeof value.expiresAt === 'string'
    && Number.isFinite(Date.parse(value.expiresAt))
    && 'partnerName' in value
    && typeof value.partnerName === 'string'
    && value.partnerName.trim().length > 0
  )
}

const readStoredSession = (): null | PartnerPortalSession => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSession(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  }
  catch {
    window.sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
}

let currentSession = readStoredSession()

const emit = (): void => listeners.forEach(listener => listener())

export const clearPartnerPortalSession = (): void => {
  currentSession = null
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(STORAGE_KEY)
  }
  emit()
}

export const getPartnerPortalSession = (): null | PartnerPortalSession => {
  if (currentSession && Date.parse(currentSession.expiresAt) <= Date.now()) {
    clearPartnerPortalSession()
  }
  return currentSession
}

export const getPartnerPortalToken = (): null | string => (
  getPartnerPortalSession()?.accessToken ?? null
)

export const setPartnerPortalSession = (session: PartnerPortalSession): void => {
  currentSession = session
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  }
  emit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const usePartnerPortalSession = (): null | PartnerPortalSession => (
  useSyncExternalStore(subscribe, getPartnerPortalSession, () => null)
)
