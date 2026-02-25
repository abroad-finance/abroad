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
