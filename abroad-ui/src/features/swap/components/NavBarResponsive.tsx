import {
  Clock, Info, Moon, Sun, User,
} from 'lucide-react'
import React, { memo } from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'
import type { ChainPillChain } from '../../../components/ui'
import { ChainPill } from '../../../components/ui'
import { AB_STYLES, BRAND_TITLE_CLASS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

/* ── Props ── */

export interface NavBarResponsiveProps {
  address?: null | string
  balance: string
  balanceLoading: boolean
  className?: string
  /** When set with onOpenChainModal, shows the chain/token pill (e.g. "USDC on Stellar") */
  selectedChainKey?: string
  selectedTokenLabel?: string
  infoUrl: string
  isDark?: boolean
  labels: {
    connectWallet: string
    connectWalletAria: string
    history?: string
    infoAriaLabel: string
    notConnected: string
    walletDetailsAria: string
  }
  languageSelector?: React.ReactNode
  languageSelectorMobile?: React.ReactNode
  onHistoryClick?: () => void
  onOpenChainModal?: () => void
  onToggleTheme?: () => void
  onWalletClick: () => void
  walletInfo: {
    icon?: string
    name: string
  }
}

const NAV_BUTTON_CLASS = 'p-2 rounded-full transition-colors cursor-pointer'

const CHAIN_PILL_THEME: Record<string, ChainPillChain> = {
  celo: { bgColor: 'var(--ab-chain-celo-bg)', color: 'var(--ab-chain-celo)', icon: '🟢', name: 'Celo' },
  solana: { bgColor: 'var(--ab-chain-solana-bg)', color: 'var(--ab-chain-solana)', icon: '🟣', name: 'Solana' },
  stellar: { bgColor: 'var(--ab-chain-stellar-bg)', color: 'var(--ab-chain-stellar)', icon: '⚫', name: 'Stellar' },
}

function chainPillChainFromKey(chainKey: string): ChainPillChain {
  const prefix = chainKey.toLowerCase().split(':')[0]
  return CHAIN_PILL_THEME[prefix] ?? CHAIN_PILL_THEME.stellar
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({
  address,
  balance,
  balanceLoading,
  className = '',
  infoUrl,
  isDark = false,
  labels,
  languageSelector,
  languageSelectorMobile,
  onHistoryClick,
  onOpenChainModal,
  onToggleTheme,
  onWalletClick,
  selectedChainKey,
  selectedTokenLabel,
}) => {
  const openInfo = () => window.open(infoUrl, '_blank', 'noopener,noreferrer')
  const isConnected = Boolean(address)
  const chainPillChain = selectedChainKey ? chainPillChainFromKey(selectedChainKey) : null
  const showChainPill = isConnected && chainPillChain && selectedTokenLabel && onOpenChainModal

  const actionButtons = (
    <>
      {onToggleTheme && (
        <button
          aria-label="Toggle theme"
          className={cn(NAV_BUTTON_CLASS, AB_STYLES.textSecondary)}
          onClick={onToggleTheme}
          type="button"
        >
          {isDark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
        </button>
      )}
      {showChainPill && chainPillChain && (
        <ChainPill
          chain={chainPillChain}
          compact
          onClick={onOpenChainModal}
          tokenLabel={selectedTokenLabel}
          className="hidden md:flex"
        />
      )}
      {isConnected && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border px-3.5 py-2',
            'bg-[var(--ab-green-soft)] border-[var(--ab-green-border)]',
          )}
        >
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ab-green)]" />
          <span className="text-[13px] font-bold text-[var(--ab-text)]">
            {balanceLoading ? '…' : `$${balance}`}
          </span>
        </div>
      )}
      {address && (
        <button
          aria-label={labels.walletDetailsAria}
          className={cn(NAV_BUTTON_CLASS, AB_STYLES.badgeBg)}
          onClick={onWalletClick}
          type="button"
        >
          <User className={cn('w-4 h-4', AB_STYLES.text)} />
        </button>
      )}
      <button
        aria-label={labels.infoAriaLabel}
        className={cn(NAV_BUTTON_CLASS, AB_STYLES.textSecondary)}
        onClick={openInfo}
        type="button"
      >
        <Info aria-hidden="true" className="w-4.5 h-4.5" />
      </button>
    </>
  )

  return (
    <nav className={cn('sticky top-0 z-[100] w-full border-b', className)} style={{ backgroundColor: 'var(--ab-bg-card)', borderColor: 'var(--ab-border)' }} role="navigation">
      {/* Mobile: full width bar - only logo and connect button */}
      <div className="md:hidden px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-shrink-0 items-center">
            <img
              alt="Abroad"
              className="h-6 w-auto"
              src={isDark ? AbroadLogoWhite : AbroadLogoColored}
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="md:hidden">{languageSelectorMobile}</div>
            {!isConnected && (
              <button
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--ab-green)' }}
                onClick={onWalletClick}
                type="button"
              >
                {labels.connectWallet}
              </button>
            )}
            {actionButtons}
          </div>
        </div>
      </div>

      {/* Desktop: flat toolbar */}
      <div className={cn('hidden md:flex items-center justify-between h-16 px-6 w-full')}>
        <div className="flex items-center gap-4">
          <img
            alt="Abroad"
            className="h-7 w-auto flex-shrink-0"
            src={isDark ? AbroadLogoWhite : AbroadLogoColored}
          />
          {isConnected && onHistoryClick && (
            <button
              className={cn('flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-[13px] font-semibold', AB_STYLES.textSecondary, 'bg-[var(--ab-bg-muted)] border-[var(--ab-border)]')}
              onClick={onHistoryClick}
              type="button"
            >
              <Clock className="h-3.5 w-3.5" />
              {labels.history ?? 'History'}
            </button>
          )}
          {!isConnected && (
            <span className={cn('text-sm font-semibold', BRAND_TITLE_CLASS)}>Swap</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div>{languageSelector}</div>
          {!isConnected && (
            <button
              className={cn('rounded-xl bg-[var(--ab-green)] px-6 py-2.5 text-sm font-bold text-white')}
              onClick={onWalletClick}
              type="button"
            >
              {labels.connectWallet}
            </button>
          )}
          {actionButtons}
        </div>
      </div>
    </nav>
  )
}

export default memo(NavBarResponsive)
