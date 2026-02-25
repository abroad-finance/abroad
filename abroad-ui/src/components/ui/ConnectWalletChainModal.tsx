import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import React from 'react'

import { Overlay } from './Overlay'
import { cn } from '../../shared/utils'

const CHAIN_THEME: Record<string, { bg: string, color: string, icon: string }> = {
  Celo: { bg: 'var(--ab-chain-celo-bg)', color: 'var(--ab-chain-celo)', icon: '🟢' },
  Solana: { bg: 'var(--ab-chain-solana-bg)', color: 'var(--ab-chain-solana)', icon: '🟣' },
  Stellar: { bg: 'var(--ab-chain-stellar-bg)', color: 'var(--ab-chain-stellar)', icon: '⚫' },
}

function chainTheme(label: string): { bg: string, color: string, icon: string } {
  const prefix = Object.keys(CHAIN_THEME).find(p => label.startsWith(p))
  return prefix ? CHAIN_THEME[prefix] : CHAIN_THEME.Stellar
}

function chainShortName(label: string): string {
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
          className="w-full max-w-[400px] rounded-[24px] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
          exit={{ opacity: 0, scale: 0.98, y: 8 }}
          initial={{ opacity: 0, scale: 0.98, y: 8 }}
          style={{ background: 'var(--ab-bg-card)' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-lg font-extrabold text-[var(--ab-text)]">Connect wallet</h3>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--ab-bg-muted)] text-[var(--ab-text-muted)] transition-colors hover:bg-[var(--ab-border)]"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mb-5 text-sm text-[var(--ab-text-secondary)]">
            Choose the blockchain you want to use. Then we’ll show the right wallet options (e.g. Stellar extensions or WalletConnect for Celo/Solana).
          </p>

          <div className="flex flex-col gap-2">
            {chains.map((chain) => {
              const theme = chainTheme(chain.label)
              return (
                <button
                  className={cn(
                    'flex items-center gap-4 rounded-[14px] border-2 px-4 py-4 text-left transition-all',
                    'border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] hover:border-[var(--ab-green-border)] hover:bg-[var(--ab-green-soft)]',
                  )}
                  key={chain.key}
                  onClick={() => handleSelect(chain.key)}
                  style={{
                    borderColor: 'var(--ab-border)',
                  }}
                  type="button"
                >
                  <span className="text-[28px]">{theme.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-[var(--ab-text)]">{chainShortName(chain.label)}</div>
                    <div className="text-xs text-[var(--ab-text-muted)]">
                      {chain.label.startsWith('Stellar')
                        ? 'Freighter, LOBSTR, WalletConnect, etc.'
                        : 'WalletConnect (QR or app)'}
                    </div>
                  </div>
                  <span className="text-[var(--ab-text-muted)]">→</span>
                </button>
              )
            })}
          </div>
        </motion.div>
      </Overlay>
    </AnimatePresence>
  )
}
