import { getAddress } from 'ethers'

import type { WalletConnectRequest } from '../../interfaces/IWallet'

export const MINIPAY_CHAIN_ID = 'eip155:42220' as const
export const MINIPAY_ADD_CASH_URL = 'https://minipay.opera.com/add_cash'

const MINIPAY_SESSION_ADDRESS_KEY = 'abroad:minipay:address'
const MINI_PAY_FEE_FIELDS = new Set(['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'])

export interface MiniPaySessionStore {
  getItem(key: string): null | string
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export interface MiniPayBrowserRuntime {
  provider: MiniPayEthereumProvider
  sessionStore: MiniPaySessionStore | null
}

export type MiniPayAddressResolution = {
  address: null | string
  source: 'missing' | 'provider' | 'session'
}

const hasWindow = (): boolean => typeof window !== 'undefined'

const getMiniPaySessionStore = (): MiniPaySessionStore | null => {
  if (!hasWindow()) {
    return null
  }

  try {
    return window.sessionStorage
  }
  catch {
    return null
  }
}

export const isMiniPayEnvironment = (): boolean => {
  if (!hasWindow()) {
    return false
  }
  return window.ethereum?.isMiniPay === true
}

export const getMiniPayProvider = (
  provider: MiniPayEthereumProvider | undefined = hasWindow() ? window.ethereum : undefined,
): MiniPayEthereumProvider => {
  if (!provider || provider.isMiniPay !== true) {
    throw new Error('MiniPay provider is not available')
  }
  return provider
}

export const getMiniPayBrowserRuntime = (): MiniPayBrowserRuntime | null => {
  if (!hasWindow()) {
    return null
  }

  const provider = window.ethereum
  if (!provider || provider.isMiniPay !== true) {
    return null
  }

  return {
    provider,
    sessionStore: getMiniPaySessionStore(),
  }
}

export const normalizeWalletAddress = (value: string): string => getAddress(value)

export const readMiniPaySessionAddress = (sessionStore: MiniPaySessionStore | null): null | string => {
  if (!sessionStore) {
    return null
  }

  try {
    const value = sessionStore.getItem(MINIPAY_SESSION_ADDRESS_KEY)
    return value ? normalizeWalletAddress(value) : null
  }
  catch {
    return null
  }
}

export const writeMiniPaySessionAddress = (
  sessionStore: MiniPaySessionStore | null,
  address: null | string,
): void => {
  if (!sessionStore) {
    return
  }

  try {
    if (!address) {
      sessionStore.removeItem(MINIPAY_SESSION_ADDRESS_KEY)
      return
    }
    sessionStore.setItem(MINIPAY_SESSION_ADDRESS_KEY, normalizeWalletAddress(address))
  }
  catch {
    // Embedded browsers can deny session storage access.
  }
}

export const resolveMiniPayAddress = async (
  runtime: MiniPayBrowserRuntime,
): Promise<MiniPayAddressResolution> => {
  const accounts = await runtime.provider.request<string[]>({ method: 'eth_requestAccounts' })
  const [address] = Array.isArray(accounts) ? accounts : []

  if (!address) {
    const cachedAddress = readMiniPaySessionAddress(runtime.sessionStore)
    return {
      address: cachedAddress,
      source: cachedAddress ? 'session' : 'missing',
    }
  }

  const normalizedAddress = normalizeWalletAddress(address)
  writeMiniPaySessionAddress(runtime.sessionStore, normalizedAddress)

  return {
    address: normalizedAddress,
    source: 'provider',
  }
}

const isRequestParameterObject = (
  value: Array<unknown> | Record<string, unknown> | unknown,
): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const sanitizeMiniPayTransactionParams = (
  params: WalletConnectRequest['params'],
): WalletConnectRequest['params'] => {
  if (!Array.isArray(params)) {
    return params
  }

  const [transactionCandidate, ...remainingParams] = params
  if (!isRequestParameterObject(transactionCandidate)) {
    return params
  }

  const sanitizedTransaction = Object.fromEntries(
    Object.entries(transactionCandidate).filter(([key]) => !MINI_PAY_FEE_FIELDS.has(key)),
  )

  return [sanitizedTransaction, ...remainingParams]
}

export const sanitizeMiniPayRequest = (
  request: WalletConnectRequest,
): WalletConnectRequest => {
  if (request.method !== 'eth_sendTransaction') {
    return request
  }

  return {
    ...request,
    params: sanitizeMiniPayTransactionParams(request.params),
  }
}
