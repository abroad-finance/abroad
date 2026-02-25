import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, X } from 'lucide-react'
import React from 'react'

import { ASSET_URLS } from '../../shared/constants'
import { Overlay } from './Overlay'
import { cn } from '../../shared/utils'

const CHAIN_CONFIG: Record<string, { bg: string, color: string, icon: string, wallets: string }> = {
  Celo: {
    bg: 'var(--ab-chain-celo-bg)',
    color: 'var(--ab-chain-celo)',
    icon: ASSET_URLS.CELO_CHAIN_ICON,
    wallets: 'WalletConnect (QR or app)',
  },
  Solana: {
    bg: 'var(--ab-chain-solana-bg)',
    color: 'var(--ab-chain-solana)',
    icon: ASSET_URLS.SOLANA_CHAIN_ICON,
    wallets: 'WalletConnect (QR or app)',
  },
  Stellar: {
    bg: 'var(--ab-chain-stellar-bg)',
    color: 'var(--ab-chain-stellar)',
    icon: ASSET_URLS.STELLAR_CHAIN_ICON,
    wallets: 'Freighter, LOBSTR, WalletConnect',
  },
}

function getChainConfig(label: string) {
  const prefix = Object.keys(CHAIN_CONFIG).find(p => label.startsWith(p))
  return prefix ? CHAIN_CONFIG[prefix] : CHAIN_CONFIG.Stellar
}

function getChainName(label: string): string {
  if (label.startsWith('Celo')) return 'Celo'
  if (label.startsWith('Solana')) return 'Solana'
  if (label.startsWith('Stellar')) return 'Stellar'
  return label
}

export interface ConnectWalletChainModalProps {
  chains: Array<{ key: string, label: string }>
  onClose: () => void
  onSelectChain: (key: string) => void
  /** Called after user selects a chain so the app can trigger connect (after corridor/wallet update) */
  onConnectRequest: () => void
  open: boolean
}

/**
 * First step of "Connect Wallet": user selects blockchain (Stellar / Celo / Solana).
 * On select we call onSelectChain, onConnectRequest, and onClose so the app can
 * set the corridor, switch wallet (Stellar Kit vs WalletConnect), then open the right connect flow.
 */
export function ConnectWalletChainModal({
  chains,
  onClose,
  onConnectRequest,
  onSelectChain,
  open,
}: ConnectWalletChainModalProps): React.JSX.Element | null {
  if (!open) return null

  const handleSelect = (key: string) => {
    onSelectChain(key)
    onConnectRequest()
    onClose()
  }

  return (
    <AnimatePresence>
      <Overlay onClose={onClose}>
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="w-full max-w-[400px] rounded-3xl bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,0.12)] dark:bg-ab-card"
          exit={{ opacity: 0, scale: 0.98, y: 8 }}
          initial={{ opacity: 0, scale: 0.98, y: 8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="mb-6 flex items-center justify-between">
            <h3 className="font-urbanist text-xl font-semibold text-gray-900 dark:text-white">
              Connect wallet
            </h3>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200 dark:bg-ab-bg-muted dark:text-gray-400 dark:hover:bg-ab-hover"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-6 text-sm text-gray-500 dark:text-ab-text-secondary">
            Choose the blockchain you want to use. Then we&apos;ll show the right wallet options.
          </p>

          <div className="flex flex-col gap-3">
            {chains.map((chain) => {
              const config = getChainConfig(chain.label)
              const chainName = getChainName(chain.label)
              return (
                <button
                  className={cn(
                    'flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-all duration-200',
                    'border-gray-200 bg-gray-50 hover:border-ab-green hover:bg-ab-green-soft dark:border-ab-border dark:bg-ab-bg-subtle dark:hover:border-ab-green',
                  )}
                  key={chain.key}
                  onClick={() => handleSelect(chain.key)}
                  type="button"
                >
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: config.bg }}
                  >
                    <img
                      alt={chainName}
                      className="h-7 w-7 object-contain"
                      src={config.icon}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-urbanist text-base font-semibold text-gray-900 dark:text-white">
                      {chainName}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-ab-text-muted">
                      {config.wallets}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400" />
                </button>
              )
            })}
          </div>
        </motion.div>
      </Overlay>
    </AnimatePresence>
  )
}
