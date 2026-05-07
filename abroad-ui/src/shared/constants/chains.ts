/**
 * Shared chain configurations
 * Consolidated from multiple duplicated definitions across the codebase
 */

// Chain icon imports - defined inline to avoid circular dependency with index.ts
import celoCeloLogo from '@/assets/Logos/Blockchains/celo-celo-logo.svg'
import solanaSolLogo from '@/assets/Logos/Blockchains/solana-sol-logo.svg'
import stellarXlmLogo from '@/assets/Logos/Blockchains/stellar-xlm-logo.svg'

/**
 * Single source of truth for chain definitions.
 * All other chain config objects are derived from this array.
 */
const CHAINS = [
  {
    bg: 'var(--ab-chain-celo-bg)',
    color: 'var(--ab-chain-celo)',
    icon: celoCeloLogo,
    key: 'celo',
    label: 'Celo',
    wallets: 'WalletConnect (QR or app)',
  },
  {
    bg: 'var(--ab-chain-solana-bg)',
    color: 'var(--ab-chain-solana)',
    icon: solanaSolLogo,
    key: 'solana',
    label: 'Solana',
    wallets: 'WalletConnect (QR or app)',
  },
  {
    bg: 'var(--ab-chain-stellar-bg)',
    color: 'var(--ab-chain-stellar)',
    icon: stellarXlmLogo,
    key: 'stellar',
    label: 'Stellar',
    wallets: 'Freighter, LOBSTR, WalletConnect',
  },
] as const

export const CHAIN_CONFIG: Record<string, { bg: string, color: string, icon: string, wallets: string }>
  = Object.fromEntries(CHAINS.map(c => [c.label, {
    bg: c.bg, color: c.color, icon: c.icon, wallets: c.wallets,
  }]))

export const CHAIN_SIMPLE_CONFIG: Record<string, { bg: string, icon: string }>
  = Object.fromEntries(CHAINS.map(c => [c.label, { bg: c.bg, icon: c.icon }]))

export const CHAIN_ICON_MAP: Record<string, string> = Object.fromEntries(
  CHAINS.flatMap(c => [
    [c.key.toUpperCase(), c.icon],
    [c.key, c.icon],
    [c.label, c.icon],
  ]),
)

export const CHAIN_MAP: Record<string, { bg: string, color: string, icon: string, name: string }>
  = Object.fromEntries(CHAINS.map(c => [c.key, {
    bg: c.bg, color: c.color, icon: c.icon, name: c.label,
  }]))

export const CHAIN_CONFIG_ARRAY = CHAINS.map(c => ({ icon: c.icon, key: c.key, label: c.label }))

/** Lookup chain config with Stellar fallback. */
export const resolveChainConfig = (key: string): { bg: string, icon: string } =>
  CHAIN_SIMPLE_CONFIG[key] ?? CHAIN_SIMPLE_CONFIG.Stellar
