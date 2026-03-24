/**
 * Shared chain configurations
 * Consolidated from multiple duplicated definitions across the codebase
 */

// Chain icon imports - defined inline to avoid circular dependency with index.ts
import celoCeloLogo from '@/assets/Logos/Blockchains/celo-celo-logo.svg'
import solanaSolLogo from '@/assets/Logos/Blockchains/solana-sol-logo.svg'
import stellarXlmLogo from '@/assets/Logos/Blockchains/stellar-xlm-logo.svg'

const CELO_ICON = celoCeloLogo
const SOLANA_ICON = solanaSolLogo
const STELLAR_ICON = stellarXlmLogo

/**
 * Basic chain config for UI display (used in ConnectWalletChainModal)
 */
export const CHAIN_CONFIG: Record<string, { bg: string, color: string, icon: string, wallets: string }> = {
  Celo: {
    bg: 'var(--ab-chain-celo-bg)',
    color: 'var(--ab-chain-celo)',
    icon: CELO_ICON,
    wallets: 'WalletConnect (QR or app)',
  },
  Solana: {
    bg: 'var(--ab-chain-solana-bg)',
    color: 'var(--ab-chain-solana)',
    icon: SOLANA_ICON,
    wallets: 'WalletConnect (QR or app)',
  },
  Stellar: {
    bg: 'var(--ab-chain-stellar-bg)',
    color: 'var(--ab-chain-stellar)',
    icon: STELLAR_ICON,
    wallets: 'Freighter, LOBSTR, WalletConnect',
  },
}

/**
 * Simplified chain config for transaction lists (used in HistorySheet, TxDetailSheet)
 */
export const CHAIN_SIMPLE_CONFIG: Record<string, { bg: string, icon: string }> = {
  Celo: { bg: 'var(--ab-chain-celo-bg)', icon: CELO_ICON },
  Solana: { bg: 'var(--ab-chain-solana-bg)', icon: SOLANA_ICON },
  Stellar: { bg: 'var(--ab-chain-stellar-bg)', icon: STELLAR_ICON },
}

/**
 * Chain icon map keyed by various case formats
 */
export const CHAIN_ICON_MAP: Record<string, string> = {
  CELO: CELO_ICON,
  celo: CELO_ICON,
  Celo: CELO_ICON,
  SOLANA: SOLANA_ICON,
  solana: SOLANA_ICON,
  Solana: SOLANA_ICON,
  STELLAR: STELLAR_ICON,
  stellar: STELLAR_ICON,
  Stellar: STELLAR_ICON,
}

/**
 * Chain short labels map
 */
export const CHAIN_SHORT_LABELS: Record<string, string> = {
  celo: 'Celo',
  solana: 'Solana',
  stellar: 'Stellar',
}

/**
 * Chain map for HomeScreen with name property
 */
export const CHAIN_MAP: Record<string, { bg: string, color: string, icon: string, name: string }> = {
  celo: {
    bg: 'var(--ab-chain-celo-bg)',
    color: 'var(--ab-chain-celo)',
    icon: CELO_ICON,
    name: 'Celo',
  },
  solana: {
    bg: 'var(--ab-chain-solana-bg)',
    color: 'var(--ab-chain-solana)',
    icon: SOLANA_ICON,
    name: 'Solana',
  },
  stellar: {
    bg: 'var(--ab-chain-stellar-bg)',
    color: 'var(--ab-chain-stellar)',
    icon: STELLAR_ICON,
    name: 'Stellar',
  },
}

/**
 * Array of chain configs for HomeScreen onboarding
 */
export const CHAIN_CONFIG_ARRAY = [
  { icon: STELLAR_ICON, key: 'stellar', label: 'Stellar' },
  { icon: CELO_ICON, key: 'celo', label: 'Celo' },
  { icon: SOLANA_ICON, key: 'solana', label: 'Solana' },
] as const
