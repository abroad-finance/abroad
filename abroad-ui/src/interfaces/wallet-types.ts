/**
 * Tipos unificados para conexiones multi-chain
 */

export type ChainNamespace = 'eip155' | 'solana' | 'stellar' | 'bip122'

export interface ChainInfo {
  namespace: ChainNamespace
  chainId: string
  name: string
  rpcUrl?: string
  explorerUrl?: string
  nativeCurrency?: {
    name: string
    symbol: string
    decimals: number
  }
}

export interface WalletConnectionState {
  isConnected: boolean
  address: string | null
  chainId: string | null
  isConnecting: boolean
  isDisconnecting: boolean
  error: import('./wallet-errors').WalletError | null
}
