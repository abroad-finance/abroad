import { useSyncExternalStore } from 'react'

let opsApiKey: null | string = null
const listeners = new Set<() => void>()

const notify = () => {
  listeners.forEach(listener => listener())
}

export const getOpsApiKey = (): null | string => opsApiKey

export const setOpsApiKey = (value: null | string): void => {
  const next = value?.trim() || null
  if (next === opsApiKey) return
  opsApiKey = next
  notify()
}

export const clearOpsApiKey = (): void => {
  if (!opsApiKey) return
  opsApiKey = null
  notify()
}

export const subscribeOpsApiKey = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => opsApiKey

export const useOpsApiKey = (): null | string => (
  useSyncExternalStore(subscribeOpsApiKey, getSnapshot, getSnapshot)
)
