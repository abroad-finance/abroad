import { getAddress } from 'ethers'

export const MINIPAY_CHAIN_ID = 'eip155:42220'
export const MINIPAY_ADD_CASH_URL = 'https://minipay.opera.com/add_cash'
export const MINIPAY_SESSION_ADDRESS_KEY = 'abroad:minipay:address'

export const MINIPAY_STABLECOIN_ADDRESSES = {
  cUSD: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  USDC: '0x37f750B7Cc259a2f741Af45294f6a16572CF5cAd',
  USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
} as const

export const isMiniPayEnvironment = (): boolean => window.ethereum?.isMiniPay === true

export const getMiniPayProvider = (): MiniPayEthereumProvider => {
  const provider = window.ethereum
  if (!provider || provider.isMiniPay !== true) {
    throw new Error('MiniPay provider is not available')
  }
  return provider
}

export const normalizeWalletAddress = (value: string): string => getAddress(value)

export const readMiniPaySessionAddress = (): null | string => {
  try {
    const value = sessionStorage.getItem(MINIPAY_SESSION_ADDRESS_KEY)
    return value ? normalizeWalletAddress(value) : null
  }
  catch {
    return null
  }
}

export const writeMiniPaySessionAddress = (address: null | string): void => {
  try {
    if (!address) {
      sessionStorage.removeItem(MINIPAY_SESSION_ADDRESS_KEY)
      return
    }
    sessionStorage.setItem(MINIPAY_SESSION_ADDRESS_KEY, normalizeWalletAddress(address))
  }
  catch {
    // Ignore session storage failures in embedded browsers.
  }
}

export const resolveMiniPayAddress = async (): Promise<null | string> => {
  const provider = getMiniPayProvider()
  const accounts = await provider.request<string[]>({ method: 'eth_requestAccounts' })
  const [address] = Array.isArray(accounts) ? accounts : []
  if (!address) {
    return readMiniPaySessionAddress()
  }
  const normalizedAddress = normalizeWalletAddress(address)
  writeMiniPaySessionAddress(normalizedAddress)
  return normalizedAddress
}

export const sanitizeMiniPayTransactionParams = (
  params: Array<unknown> | Record<string, unknown>,
): Array<unknown> | Record<string, unknown> => {
  if (!Array.isArray(params)) {
    return params
  }

  const [firstParam, ...rest] = params
  if (typeof firstParam !== 'object' || firstParam === null) {
    return params
  }

  const tx = firstParam as Record<string, unknown>
  const sanitizedTx: Record<string, unknown> = {}
  Object.entries(tx).forEach(([key, value]) => {
    if (key === 'gasPrice' || key === 'maxFeePerGas' || key === 'maxPriorityFeePerGas') {
      return
    }
    sanitizedTx[key] = value
  })

  return [sanitizedTx, ...rest]
}
