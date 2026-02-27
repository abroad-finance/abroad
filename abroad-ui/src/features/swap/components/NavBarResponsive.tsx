import {
  Clock, Info, LogOut, Moon, Sun, User,
} from 'lucide-react'
import React, { memo } from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'
import type { ChainPillChain } from '../../../components/ui'
import { ChainPill, CurrencyToggle } from '../../../components/ui'
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
    disconnectAria?: string
    disconnectTitle?: string
    history?: string
    infoAriaLabel: string
    notConnected: string
    walletDetailsAria: string
  }
  languageSelector?: React.ReactNode
  languageSelectorMobile?: React.ReactNode
  onDisconnect?: () => Promise<void>
  onHistoryClick?: () => void
  onOpenChainModal?: () => void
  onSelectCurrency?: (currency: 'COP' | 'BRL') => void
  targetCurrency?: 'COP' | 'BRL'
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
  onDisconnect,
  onHistoryClick,
  onOpenChainModal,
  onSelectCurrency,
  onToggleTheme,
  onWalletClick,
  selectedChainKey,
  selectedTokenLabel,
  targetCurrency,
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
      {isConnected && onSelectCurrency && targetCurrency && (
        <div className="hidden md:block">
          <CurrencyToggle
            value={targetCurrency}
            onChange={onSelectCurrency}
          />
        </div>
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
          className="flex items-center gap-2 rounded-full border border-[#d1fae5] bg-[#ecfdf5] px-[13px] py-[7px]"
        >
          <div className="h-2 w-2 shrink-0 rounded-full bg-[#10b981]" />
          <span className="text-sm font-bold leading-5 text-[#047857]">
            {balanceLoading ? '…' : `$${balance}`}
          </span>
        </div>
      )}
      {address && (
        <>
          <button
            aria-label={labels.walletDetailsAria}
            className={cn(NAV_BUTTON_CLASS, AB_STYLES.badgeBg)}
            onClick={onWalletClick}
            type="button"
          >
            <User className={cn('w-4 h-4', AB_STYLES.text)} />
          </button>
          {onDisconnect && (
            <button
              aria-label={labels.disconnectAria ?? 'Desconectar billetera'}
              className={cn(NAV_BUTTON_CLASS, AB_STYLES.textSecondary)}
              onClick={() => void onDisconnect()}
              title={labels.disconnectTitle ?? 'Desconectar billetera'}
              type="button"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </>
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
    <nav
      className={cn(
        'sticky top-0 z-[100] w-full border-b border-[#f3f4f6] py-4 px-6 backdrop-blur-[6px]',
        className
      )}
      role="navigation"
      style={{ backgroundColor: 'rgba(255,255,255,0.5)' }}
    >
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
        <div className="flex items-center gap-3">
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
