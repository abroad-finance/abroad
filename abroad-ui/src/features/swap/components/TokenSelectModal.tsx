import { AnimatePresence, motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import React, { useCallback, useMemo, useState } from 'react'

import { ASSET_URLS } from '../../../shared/constants'

/* ── Types ── */

export interface TokenOption {
  icon?: string
  key: string
  label: string
  subtitle?: string
}

export interface ChainOption {
  icon?: string
  key: string
  label: string
}

interface TokenSelectModalProps {
  chains: ChainOption[]
  onClose: () => void
  onSelectChain?: (key: string) => void
  onSelectToken: (key: string) => void
  open: boolean
  selectedChainKey?: string
  selectedTokenKey?: string
  title: string
  tokens: TokenOption[]
}

/* ── Chain icon mapping ── */

const CHAIN_ICONS: Record<string, string> = {
  Celo: ASSET_URLS.CELO_CHAIN_ICON,
  Solana: ASSET_URLS.SOLANA_CHAIN_ICON,
  Stellar: ASSET_URLS.STELLAR_CHAIN_ICON,
}

const CURRENCY_ICONS: Record<string, string> = {
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
}

function resolveIcon(label: string, icon?: string): string | undefined {
  if (icon) return icon
  return CHAIN_ICONS[label] || CURRENCY_ICONS[label]
}

/* ── Component ── */

const TokenSelectModal: React.FC<TokenSelectModalProps> = ({
  chains,
  onClose,
  onSelectChain,
  onSelectToken,
  open,
  selectedChainKey,
  selectedTokenKey,
  title,
  tokens,
}) => {
  const [search, setSearch] = useState('')

  const filteredTokens = useMemo(() => {
    if (!search.trim()) return tokens
    const q = search.toLowerCase()
    return tokens.filter(
      t => t.label.toLowerCase().includes(q) || t.subtitle?.toLowerCase().includes(q),
    )
  }, [tokens, search])

  const handleSelect = useCallback((key: string) => {
    onSelectToken(key)
    setSearch('')
    onClose()
  }, [onSelectToken, onClose])

  const handleChainSelect = useCallback((key: string) => {
    onSelectChain?.(key)
  }, [onSelectChain])

  // Reset search on close
  const handleClose = useCallback(() => {
    setSearch('')
    onClose()
  }, [onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onClick={handleClose}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative w-full max-w-sm rounded-3xl p-6 shadow-2xl"
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--ab-modal-bg)',
              borderColor: 'var(--ab-modal-border)',
              borderStyle: 'solid',
              borderWidth: '1px',
            }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--ab-text)' }}>
                {title}
              </h2>
              <button
                className="p-1.5 rounded-full transition-colors cursor-pointer"
                onClick={handleClose}
                style={{ color: 'var(--ab-text-muted)' }}
                type="button"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-5"
              style={{
                background: 'var(--ab-input)',
                border: '1px solid var(--ab-input-border)',
              }}
            >
              <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--ab-text-muted)' }} />
              <input
                className="w-full bg-transparent text-sm focus:outline-none"
                onChange={e => setSearch(e.target.value)}
                placeholder="Search"
                style={{ color: 'var(--ab-text)' }}
                type="text"
                value={search}
              />
            </div>

            {/* Chain Grid */}
            {chains.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5">
                {chains.map(chain => {
                  const isSelected = chain.key === selectedChainKey
                  const icon = resolveIcon(chain.label, chain.icon)
                  return (
                    <button
                      className="w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer"
                      key={chain.key}
                      onClick={() => handleChainSelect(chain.key)}
                      style={{
                        background: isSelected ? 'var(--ab-selected)' : 'var(--ab-hover)',
                        border: isSelected ? '2px solid var(--ab-btn)' : '2px solid transparent',
                      }}
                      title={chain.label}
                      type="button"
                    >
                      {icon
                        ? <img alt={chain.label} className="w-7 h-7 rounded-full" src={icon} />
                        : (
                            <span className="text-xs font-bold" style={{ color: 'var(--ab-text)' }}>
                              {chain.label.slice(0, 2)}
                            </span>
                          )}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Chain label */}
            {selectedChainKey && chains.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                {(() => {
                  const chain = chains.find(c => c.key === selectedChainKey)
                  const icon = chain ? resolveIcon(chain.label, chain.icon) : undefined
                  return (
                    <>
                      {icon && <img alt="" className="w-5 h-5 rounded-full" src={icon} />}
                      <span className="text-sm font-medium" style={{ color: 'var(--ab-text-secondary)' }}>
                        {chain?.label} tokens
                      </span>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Token List */}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {filteredTokens.length === 0 && (
                <p className="text-center py-4 text-sm" style={{ color: 'var(--ab-text-muted)' }}>
                  No results
                </p>
              )}
              {filteredTokens.map(token => {
                const isSelected = token.key === selectedTokenKey
                const icon = token.icon || CHAIN_ICONS[token.label] || CURRENCY_ICONS[token.label]
                return (
                  <button
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all cursor-pointer"
                    key={token.key}
                    onClick={() => handleSelect(token.key)}
                    style={{
                      background: isSelected ? 'var(--ab-selected)' : 'transparent',
                    }}
                    type="button"
                  >
                    {icon
                      ? <img alt={token.label} className="w-9 h-9 rounded-full" src={icon} />
                      : (
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{ background: 'var(--ab-hover)', color: 'var(--ab-text)' }}
                          >
                            {token.label.slice(0, 2)}
                          </div>
                        )}
                    <div className="text-left">
                      <div className="font-medium text-sm" style={{ color: 'var(--ab-text)' }}>
                        {token.label}
                      </div>
                      {token.subtitle && (
                        <div className="text-xs" style={{ color: 'var(--ab-text-muted)' }}>
                          {token.subtitle}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default TokenSelectModal
