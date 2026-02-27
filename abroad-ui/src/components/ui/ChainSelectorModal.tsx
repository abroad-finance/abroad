import { AnimatePresence, motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import React, { useCallback } from 'react'

import { ASSET_URLS } from '../../shared/constants'
import { Overlay } from './Overlay'
import { cn } from '../../shared/utils'

/** Map chain label prefix to spec colors and logos (Stellar, Celo, Solana). */
const CHAIN_THEME: Record<string, { bg: string, color: string, icon: string }> = {
  Celo: { bg: 'var(--ab-chain-celo-bg)', color: 'var(--ab-chain-celo)', icon: ASSET_URLS.CELO_CHAIN_ICON },
  Solana: { bg: 'var(--ab-chain-solana-bg)', color: 'var(--ab-chain-solana)', icon: ASSET_URLS.SOLANA_CHAIN_ICON },
  Stellar: { bg: 'var(--ab-chain-stellar-bg)', color: 'var(--ab-chain-stellar)', icon: ASSET_URLS.STELLAR_CHAIN_ICON },
}

function chainTheme(label: string): { bg: string, color: string, icon: string } {
  const prefix = Object.keys(CHAIN_THEME).find(p => label.startsWith(p))
  return prefix ? CHAIN_THEME[prefix] : CHAIN_THEME.Stellar
}

function tokenColor(tokenId: string): { bg: string, text: string } {
  if (tokenId.toLowerCase() === 'usdt') return { bg: '#26A17B15', text: '#26A17B' }
  return { bg: '#2775CA15', text: '#2775CA' }
}

function tokenIconUrl(tokenId: string): string | undefined {
  const id = tokenId.toUpperCase()
  if (id === 'USDC') return ASSET_URLS.USDC_TOKEN_ICON
  if (id === 'USDT') return ASSET_URLS.USDT_TOKEN_ICON
  return undefined
}

export interface ChainSelectorModalProps {
  balance: string
  chains: Array<{ key: string, label: string }>
  onClose: () => void
  onSelectChain: (key: string) => void
  onSelectToken: (key: string) => void
  open: boolean
  selectedChainKey: string
  selectedTokenKey: string
  tokens: Array<{ key: string, label: string }>
}

/**
 * "Pay from" modal: chain tabs + token list. Selecting a token closes the modal.
 * Replaces the old "Swap from" token modal for the source selector.
 */
export const ChainSelectorModal: React.FC<ChainSelectorModalProps> = ({
  balance,
  chains,
  onClose,
  onSelectChain,
  onSelectToken,
  open,
  selectedChainKey,
  selectedTokenKey,
  tokens,
}) => {
  const selectedChain = chains.find(c => c.key === selectedChainKey)

  const handleTokenClick = useCallback((key: string) => {
    onSelectToken(key)
    onClose()
  }, [onClose, onSelectToken])

  if (!open) return null

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
            <h3 className="text-lg font-extrabold text-[var(--ab-text)]">Pay from</h3>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--ab-bg-muted)] text-[var(--ab-text-muted)] transition-colors hover:bg-[var(--ab-border)]"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Chain tabs */}
          <div className="mb-5 flex gap-2">
            {chains.map((chain) => {
              const theme = chainTheme(chain.label)
              const isSelected = chain.key === selectedChainKey
              return (
                <button
                  className={cn(
                    'flex flex-1 flex-col items-center gap-2 rounded-[14px] border-2 px-3 py-3 transition-all',
                  )}
                  key={chain.key}
                  onClick={() => onSelectChain(chain.key)}
                  style={{
                    background: isSelected ? theme.bg : 'var(--ab-bg-subtle)',
                    borderColor: isSelected ? `${theme.color}40` : 'transparent',
                  }}
                  type="button"
                >
                  <img
                    alt={chain.label}
                    className="h-8 w-8"
                    src={theme.icon}
                  />
                  <span
                    className="text-xs font-bold"
                    style={{ color: isSelected ? theme.color : 'var(--ab-text-muted)' }}
                  >
                    {chain.label.startsWith('Celo') ? 'Celo' : chain.label.startsWith('Solana') ? 'Solana' : chain.label.startsWith('Stellar') ? 'Stellar' : chain.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Token list */}
          <p
            className="mb-2.5 text-[11px] font-bold uppercase tracking-[2px] text-[var(--ab-text-muted)]"
          >
            Available tokens on {selectedChain ? (selectedChain.label.startsWith('Celo') ? 'Celo' : selectedChain.label.startsWith('Solana') ? 'Solana' : selectedChain.label.startsWith('Stellar') ? 'Stellar' : selectedChain.label) : 'Stellar'}
          </p>
          <div className="space-y-2">
            {tokens.map((token) => {
              const isSelected = token.key === selectedTokenKey
              const tColor = tokenColor(token.key)
              const iconUrl = tokenIconUrl(token.key)
              return (
                <button
                  className={cn(
                    'flex w-full items-center gap-3.5 rounded-2xl border px-4 py-4 text-left transition-all',
                  )}
                  key={token.key}
                  onClick={() => handleTokenClick(token.key)}
                  style={{
                    background: isSelected ? 'var(--ab-green-soft)' : 'var(--ab-bg-card)',
                    borderColor: isSelected ? 'var(--ab-green-border)' : 'var(--ab-border)',
                    borderWidth: '1.5px',
                  }}
                  type="button"
                >
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px]"
                    style={{ background: tColor.bg }}
                  >
                    {iconUrl ? (
                      <img
                        alt={token.label}
                        className="h-7 w-7 object-contain"
                        src={iconUrl}
                      />
                    ) : (
                      <span className="text-sm font-extrabold" style={{ color: tColor.text }}>
                        {token.label}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-[var(--ab-text)]">{token.label}</div>
                    <div className="text-xs text-[var(--ab-text-muted)]">
                      on {selectedChain ? (selectedChain.label.startsWith('Celo') ? 'Celo' : selectedChain.label.startsWith('Solana') ? 'Solana' : selectedChain.label.startsWith('Stellar') ? 'Stellar' : selectedChain.label) : 'Stellar'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[15px] font-bold text-[var(--ab-text)]">${balance}</div>
                    <div className="text-[11px] text-[var(--ab-text-muted)]">available</div>
                  </div>
                  {isSelected && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ab-green)]">
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </motion.div>
      </Overlay>
    </AnimatePresence>
  )
}
