import { AnimatePresence, motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import React, { useCallback } from 'react'

import { ASSET_URLS } from '../../shared/constants'
import { Overlay } from './Overlay'

/** Map chain label prefix to spec colors and logos (Stellar, Celo, Solana). */
const CHAIN_THEME: Record<string, { bg: string, color: string, icon: string }> = {
  Celo: { bg: 'var(--ab-chain-celo-bg)', color: 'var(--ab-chain-celo)', icon: ASSET_URLS.CELO_CHAIN_ICON },
  Solana: { bg: 'var(--ab-chain-solana-bg)', color: 'var(--ab-chain-solana)', icon: ASSET_URLS.SOLANA_CHAIN_ICON },
  Stellar: { bg: 'var(--ab-chain-stellar-bg)', color: 'var(--ab-chain-stellar)', icon: ASSET_URLS.STELLAR_CHAIN_ICON },
}

function getChainShortLabel(label: string): string {
  if (label.startsWith('Celo')) return 'Celo'
  if (label.startsWith('Solana')) return 'Solana'
  return label
}

function chainTheme(label: string): { bg: string, color: string, icon: string } {
  const prefix = Object.keys(CHAIN_THEME).find(p => label.startsWith(p))
  return prefix ? CHAIN_THEME[prefix] : CHAIN_THEME.Stellar
}

function tokenColor(tokenId: string): { bg: string, text: string } {
  if (tokenId.toLowerCase() === 'usdt') return { bg: '#26A17B15', text: '#26A17B' }
  return { bg: '#2775CA15', text: '#2775CA' }
}

function tokenIconUrl(tokenIdOrLabel: string): string | undefined {
  const token = tokenIdOrLabel.split(':')[0]?.toUpperCase() ?? tokenIdOrLabel.toUpperCase()
  if (token === 'USDC') return ASSET_URLS.USDC_TOKEN_ICON
  if (token === 'USDT') return ASSET_URLS.USDT_TOKEN_ICON
  return undefined
}

function tokenSubtitle(tokenLabel: string): string {
  const t = tokenLabel.toUpperCase()
  if (t === 'USDC') return 'USD Coin'
  if (t === 'USDT') return 'Tether USD'
  return tokenLabel
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

  const chainLabel = selectedChain ? getChainShortLabel(selectedChain.label) : 'Stellar'

  return (
    <AnimatePresence>
      <Overlay onClose={onClose}>
        <motion.div
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="flex w-full max-w-[360px] flex-col gap-4 rounded-[24px] border border-[#356E6A14] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
          exit={{ opacity: 0, scale: 0.98, y: 8 }}
          initial={{ opacity: 0, scale: 0.98, y: 8 }}
          style={{ background: '#FFFFFF' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {/* Header – Figma 36-2 tsHeader */}
          <div className="flex w-full items-center justify-between">
            <h3 className="text-lg font-semibold text-[#1a3a37]">Pay from</h3>
            <button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280] transition-colors hover:bg-[#E5E7EB]"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          {/* Chain tabs – icon + name per blockchain */}
          <div className="flex w-full gap-2">
            {chains.map((chain) => {
              const theme = chainTheme(chain.label)
              const isSelected = chain.key === selectedChainKey
              const label = getChainShortLabel(chain.label)
              return (
                <button
                  aria-pressed={isSelected}
                  className="flex flex-1 flex-col items-center gap-2 rounded-[14px] px-3 py-3 transition-all"
                  key={chain.key}
                  onClick={() => onSelectChain(chain.key)}
                  style={{
                    background: isSelected ? 'rgba(53, 110, 106, 0.1)' : 'rgba(53, 110, 106, 0.05)',
                    border: isSelected ? '2px solid #5a9a8f' : '2px solid transparent',
                  }}
                  type="button"
                >
                  <img
                    alt={label}
                    className="h-8 w-8 shrink-0 object-contain"
                    src={theme.icon}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: isSelected ? '#1a3a37' : '#7a9e9a' }}
                  >
                    {label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Token list – Figma tsTokenList: gap 4, row padding 10,12 */}
          <p className="text-[11px] font-bold uppercase tracking-[2px] text-[#7a9e9a]">
            Available tokens on {chainLabel}
          </p>
          <div className="flex flex-col gap-1">
            {tokens.map((token) => {
              const isSelected = token.key === selectedTokenKey
              const tColor = tokenColor(token.key)
              const iconUrl = tokenIconUrl(token.label)
              return (
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all"
                  key={token.key}
                  onClick={() => handleTokenClick(token.key)}
                  style={{
                    background: isSelected ? 'rgba(53, 110, 106, 0.1)' : 'transparent',
                  }}
                  type="button"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full"
                    style={{ background: tColor.bg }}
                  >
                    {iconUrl ? (
                      <img
                        alt={token.label}
                        className="h-5 w-5 object-contain"
                        src={iconUrl}
                      />
                    ) : (
                      <span className="text-xs font-bold" style={{ color: tColor.text }}>
                        {token.label}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#1a3a37]">{token.label}</div>
                    <div className="text-xs text-[#7a9e9a]">{tokenSubtitle(token.label)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[#1a3a37]">${balance}</div>
                    <div className="text-[11px] text-[#7a9e9a]">available</div>
                  </div>
                  {isSelected && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-abroad-dark">
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
