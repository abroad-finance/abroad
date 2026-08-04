import { useTranslate } from '@tolgee/react'
import { motion } from 'framer-motion'
import { Check, X } from 'lucide-react'
import React, { useCallback, useId } from 'react'

import { ModalSurface } from '../../shared/components/ModalSurface'
import { CHAIN_CONFIG, TOKEN_ICONS } from '../../shared/constants'
import { cn } from '../../shared/utils'

/** Map chain label prefix to spec colors and logos (Stellar, Celo, Solana). */
const CHAIN_THEME: Record<string, { bg: string, color: string, icon: string }> = Object.fromEntries(
  Object.entries(CHAIN_CONFIG).map(([label, { bg, color, icon }]) => [label, { bg, color, icon }]),
)

export interface ChainSelectorModalProps {
  balances: Readonly<{ USDC: null | string, USDT: null | string }>
  chains: Array<{ key: string, label: string }>
  isAuthenticated: boolean
  onClose: () => void
  onSelectChain: (key: string) => void
  onSelectToken: (key: string) => void
  open: boolean
  selectedChainKey: string
  selectedTokenKey: string
  tokens: Array<{ key: string, label: string }>
}

function chainTheme(label: string): { bg: string, color: string, icon: string } {
  const prefix = Object.keys(CHAIN_THEME).find(p => label.startsWith(p))
  return prefix ? CHAIN_THEME[prefix] : CHAIN_THEME.Stellar
}

function getChainShortLabel(label: string): string {
  if (label.startsWith('Celo')) return 'Celo'
  if (label.startsWith('Solana')) return 'Solana'
  return label
}

function tokenColor(tokenId: string): { bg: string, text: string } {
  if (tokenId.toLowerCase() === 'usdt') return { bg: 'bg-emerald-50', text: 'text-[var(--ab-green)]' }
  return { bg: 'bg-blue-50', text: 'text-[var(--ab-text)]' }
}

function tokenIconUrl(tokenIdOrLabel: string): string | undefined {
  const token = tokenIdOrLabel.split(':')[0]?.toUpperCase() ?? tokenIdOrLabel.toUpperCase()
  return TOKEN_ICONS[token]
}

function tokenSubtitle(tokenLabel: string): string {
  const t = tokenLabel.toUpperCase()
  if (t === 'USDC') return 'USD Coin'
  if (t === 'USDT') return 'Tether USD'
  return tokenLabel
}

/**
 * "Pay from" modal: chain tabs + token list. Selecting a token closes the modal.
 * Replaces the old "Swap from" token modal for the source selector.
 */
export const ChainSelectorModal: React.FC<ChainSelectorModalProps> = ({
  balances,
  chains,
  isAuthenticated,
  onClose,
  onSelectChain,
  onSelectToken,
  open,
  selectedChainKey,
  selectedTokenKey,
  tokens,
}) => {
  const { t } = useTranslate()
  const titleId = useId()
  const selectedChain = chains.find(c => c.key === selectedChainKey)

  const handleTokenClick = useCallback((key: string) => {
    onSelectToken(key)
    onClose()
  }, [onClose, onSelectToken])

  if (!open) return null

  const chainLabel = selectedChain ? getChainShortLabel(selectedChain.label) : t('chain.stellar', 'Stellar')

  return (
    <ModalSurface onClose={onClose} open={open} titleId={titleId}>
      <motion.div
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="flex w-full max-w-[360px] flex-col gap-4 rounded-[24px] border border-ab-card-border bg-ab-modal-bg p-6 shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* Header – Figma 36-2 tsHeader */}
        <div className="flex w-full items-center justify-between">
          <h2 className="text-lg font-semibold text-ab-text" id={titleId}>{t('chain_selector.pay_from', 'Pay from')}</h2>
          <button
            aria-label={t('chain_selector.close', 'Close source selector')}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ab-hover text-ab-text-2 transition-colors hover:bg-ab-selected"
            data-modal-initial-focus
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
                className={cn(
                  'flex min-h-11 flex-1 flex-col items-center gap-2 rounded-[14px] border-2 px-3 py-3 transition-all',
                  isSelected
                    ? 'border-[var(--ab-green)] bg-[var(--ab-green-soft)]'
                    : 'border-transparent bg-[var(--ab-bg-subtle)]',
                )}
                key={chain.key}
                onClick={() => onSelectChain(chain.key)}
                type="button"
              >
                <img
                  alt={label}
                  className="h-8 w-8 shrink-0 object-contain"
                  src={theme.icon}
                />
                <span className={cn('text-xs font-semibold', isSelected ? 'text-ab-text' : 'text-ab-text-2')}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Token list – Figma tsTokenList: gap 4, row padding 10,12 */}
        <p className="text-[11px] font-bold uppercase tracking-[2px] text-ab-text-2">
          {t('chain_selector.available_tokens_on', 'Available tokens on')}
          {' '}
          {chainLabel}
        </p>
        <div className="flex flex-col gap-1">
          {tokens.map((token) => {
            const isSelected = token.key === selectedTokenKey
            const tColor = tokenColor(token.key)
            const iconUrl = tokenIconUrl(token.label)
            const tokenBalance = token.label === 'USDC'
              ? balances.USDC
              : token.label === 'USDT'
                ? balances.USDT
                : null
            return (
              <button
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all',
                  isSelected && 'bg-[var(--ab-green-soft)]',
                )}
                key={token.key}
                onClick={() => handleTokenClick(token.key)}
                type="button"
              >
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full', tColor.bg)}>
                  {iconUrl
                    ? (
                        <img
                          alt={token.label}
                          className="h-5 w-5 object-contain"
                          src={iconUrl}
                        />
                      )
                    : (
                        <span className={cn('text-xs font-bold', tColor.text)}>
                          {token.label}
                        </span>
                      )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ab-text">{token.label}</div>
                  <div className="text-xs text-ab-text-2">{t(`chain_selector.token.${token.label.toLowerCase()}`, tokenSubtitle(token.label))}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-ab-text">
                    {isAuthenticated ? tokenBalance ?? '—' : '—'}
                    {isAuthenticated && tokenBalance ? ` ${token.label}` : ''}
                  </div>
                  <div className="text-[11px] text-ab-text-2">
                    {!isAuthenticated
                      ? t('chain_selector.connect_balance', 'Connect to view balance')
                      : tokenBalance === null
                        ? t('chain_selector.balance_unavailable', 'Balance unavailable')
                        : t('chain_selector.available', 'available')}
                  </div>
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
    </ModalSurface>
  )
}
