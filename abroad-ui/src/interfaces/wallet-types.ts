/**
 * Tipos unificados para conexiones multi-chain
 */

export interface ChainInfo {
  chainId: string
  explorerUrl?: string
  name: string
  namespace: ChainNamespace
  nativeCurrency?: {
    decimals: number
    name: string
    symbol: string
  }
  rpcUrl?: string
}

export type ChainNamespace = 'bip122' | 'eip155' | 'solana' | 'stellar'

export interface WalletConnectionState {
  address: null | string
  chainId: null | string
  error: import('./wallet-errors').WalletError | null
  isConnected: boolean
  isConnecting: boolean
  isDisconnecting: boolean
}
