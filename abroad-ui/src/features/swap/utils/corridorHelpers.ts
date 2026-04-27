import type { PublicCorridor } from '../../../services/public/types'

export const COP_TRANSFER_FEE = 0.0
export const BRL_TRANSFER_FEE = 0.0

export const corridorKeyOf = (corridor: PublicCorridor): string => (
  `${corridor.cryptoCurrency}:${corridor.blockchain}:${corridor.targetCurrency}`
)

export const chainKeyOf = (corridor: PublicCorridor): string => (
  `${corridor.blockchain}:${corridor.chainId}`
)

export const formatChainLabel = (value: string): string => {
  const normalized = value.toLowerCase().replace(/_/g, ' ')
  return normalized.replace(/\b\w/g, char => char.toUpperCase())
}

export const formatChainIdLabel = (value: string): string => {
  if (!value) return ''
  const [, ...rest] = value.split(':')
  return rest.length > 0 ? rest.join(':') : value
}

export const buildChainLabel = (corridor: PublicCorridor, includeChainId: boolean): string => {
  const base = formatChainLabel(corridor.blockchain)
  if (!includeChainId) return base
  const chainIdLabel = formatChainIdLabel(corridor.chainId)
  return chainIdLabel ? `${base} (${chainIdLabel})` : base
}

/** Derive STELLAR | SOLANA | CELO from chainKey (e.g. stellar:pubkey, solana:xxx, celo:42220, eip155:42220). */
export const networkFromChainKey = (chainKey: string): string => {
  const prefix = chainKey.split(':')[0]?.toLowerCase() ?? ''
  if (prefix === 'stellar') return 'STELLAR'
  if (prefix === 'solana') return 'SOLANA'
  if (prefix === 'celo' || prefix === 'eip155') return 'CELO'
  return 'STELLAR'
}

/** Check if a transaction's quote.network matches the given chainKey. */
export const transactionMatchesChain = <T extends { quote: { network: string } }>(
  tx: T,
  chainKey: string,
): boolean => (tx.quote.network?.toUpperCase() ?? '') === networkFromChainKey(chainKey)

/** Sort corridors with Stellar first (used by useSwap and useWebSwapController). */
export const sortStellarFirst = <T extends { blockchain: string }>(arr: T[]): T[] => (
  [...arr].sort((a, b) => {
    const aStellar = a.blockchain.toLowerCase() === 'stellar'
    const bStellar = b.blockchain.toLowerCase() === 'stellar'
    if (aStellar && !bStellar) return -1
    if (!aStellar && bStellar) return 1
    return 0
  })
)
