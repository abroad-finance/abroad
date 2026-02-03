import { BlockchainNetwork } from '@prisma/client'

export type ChainFamily = 'evm' | 'solana' | 'stellar'

export type ChainMetadata = {
  chainId: string
  family: ChainFamily
  walletConnect: WalletConnectMetadata
}

export type WalletConnectMetadata = {
  chainId: string
  events: string[]
  methods: string[]
  namespace: string
}

const DEFAULT_CHAIN_IDS: Record<BlockchainNetwork, string> = {
  [BlockchainNetwork.CELO]: 'eip155:42220',
  [BlockchainNetwork.SOLANA]: 'solana:mainnet',
  [BlockchainNetwork.STELLAR]: 'stellar:pubnet',
}

const DEFAULT_METADATA: Record<BlockchainNetwork, ChainMetadata> = {
  [BlockchainNetwork.CELO]: {
    chainId: DEFAULT_CHAIN_IDS[BlockchainNetwork.CELO],
    family: 'evm',
    walletConnect: {
      chainId: DEFAULT_CHAIN_IDS[BlockchainNetwork.CELO],
      events: [],
      methods: ['personal_sign', 'eth_sendTransaction'],
      namespace: 'eip155',
    },
  },
  [BlockchainNetwork.SOLANA]: {
    chainId: DEFAULT_CHAIN_IDS[BlockchainNetwork.SOLANA],
    family: 'solana',
    walletConnect: {
      chainId: DEFAULT_CHAIN_IDS[BlockchainNetwork.SOLANA],
      events: [],
      methods: ['solana_signMessage', 'solana_signTransaction'],
      namespace: 'solana',
    },
  },
  [BlockchainNetwork.STELLAR]: {
    chainId: DEFAULT_CHAIN_IDS[BlockchainNetwork.STELLAR],
    family: 'stellar',
    walletConnect: {
      chainId: DEFAULT_CHAIN_IDS[BlockchainNetwork.STELLAR],
      events: [],
      methods: ['stellar_signXDR'],
      namespace: 'stellar',
    },
  },
}

const readChainIdOverride = (blockchain: BlockchainNetwork): null | string => {
  const envKey = `CHAIN_ID_${blockchain}`
  const raw = process.env[envKey]
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const resolveChainMetadata = (blockchain: BlockchainNetwork): ChainMetadata => {
  const base = DEFAULT_METADATA[blockchain]
  const override = readChainIdOverride(blockchain)
  if (!override) return base

  return {
    ...base,
    chainId: override,
    walletConnect: {
      ...base.walletConnect,
      chainId: override,
    },
  }
}
