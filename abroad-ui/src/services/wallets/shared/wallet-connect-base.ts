/**
 * Base class para lógica compartida de WalletConnect
 * Esto elimina la duplicación entre useWalletConnectWallet y useStellarKitWallet
 */

// WalletConnect SignClient Metadata type (different from API's WalletConnectMetadata)
interface SignClientMetadata {
  description: string
  icons: string[]
  name: string
  url: string
}

export const WC_METADATA: SignClientMetadata = {
  description: 'Cambia USDC a pesos y reales en segundos',
  icons: ['https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67c084e407b55642ef7d6cd4_Favicon.png'],
  name: 'Abroad',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://app.abroad.finance',
}

export const WC_STORAGE_PREFIX = 'wc:session'

export interface WalletConnectSession {
  address: string
  chains: string[]
  topic: string
}

/**
 * Limpia sesión de WalletConnect
 */
export function clearWCSession(chainId: string): void {
  try {
    if (typeof window === 'undefined') return
    const key = `${WC_STORAGE_PREFIX}:${chainId}`
    localStorage.removeItem(key)
  }
  catch (error) {
    if (import.meta.env.DEV) {
      console.error('Failed to clear WC session', error)
    }
  }
}

/**
 * Decodifica base64 a Uint8Array
 */
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Obtiene sesión guardada de WalletConnect
 */
export function getWCSession(chainId: string): null | WalletConnectSession {
  try {
    if (typeof window === 'undefined') return null
    const key = `${WC_STORAGE_PREFIX}:${chainId}`
    const data = localStorage.getItem(key)
    return data ? (JSON.parse(data) as WalletConnectSession) : null
  }
  catch {
    return null
  }
}

/**
 * Resuelve el namespace desde un chainId
 */
export function resolveNamespaceFromChainId(chainId: string): string {
  if (chainId.startsWith('eip155:')) return 'eip155'
  if (chainId.startsWith('solana:')) return 'solana'
  if (chainId.startsWith('stellar:')) return 'stellar'
  return 'eip155'
}

/**
 * Resuelve la red Stellar (PUBLIC o TESTNET) desde chainId
 */
export function resolveStellarNetwork(chainId: string): 'PUBLIC' | 'TESTNET' {
  return chainId.toLowerCase().includes('test') ? 'TESTNET' : 'PUBLIC'
}

/**
 * Guarda sesión de WalletConnect
 */
export function saveWCSession(chainId: string, session: WalletConnectSession): void {
  try {
    if (typeof window === 'undefined') return
    const key = `${WC_STORAGE_PREFIX}:${chainId}`
    localStorage.setItem(key, JSON.stringify(session))
  }
  catch (error) {
    if (import.meta.env.DEV) {
      console.error('Failed to save WC session', error)
    }
  }
}

/**
 * Codifica Uint8Array a base64
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

/**
 * Codifica string a Uint8Array
 */
export function toUint8Array(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
