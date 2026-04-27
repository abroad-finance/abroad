import {
  Info, LogOut, Moon, Sun,
} from 'lucide-react'
import React, { memo } from 'react'

import type { ChainPillChain } from '@/components/ui'

import AbroadLogoColored from '@/assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '@/assets/Logos/AbroadLogoWhite.svg'
import { ChainPill, CurrencyToggle } from '@/components/ui'
import { AB_STYLES, ASSET_URLS, BRAND_TITLE_CLASS } from '@/shared/constants'

import { cn } from '../../../shared/utils'

/* ── Props ── */

export interface NavBarResponsiveProps {
  address?: null | string
  balance: string
  balanceLoading: boolean
  className?: string
  hideWalletButton?: boolean
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
  onSelectCurrency?: (currency: 'BRL' | 'COP') => void
  onToggleTheme?: () => void
  onWalletClick: () => void
  /** When set with onOpenChainModal, shows the chain/token pill (e.g. "USDC on Stellar") */
  selectedChainKey?: string
  selectedTokenLabel?: string
  targetCurrency?: 'BRL' | 'COP'
  walletInfo: {
    icon?: string
    name: string
  }
}

const NAV_BUTTON_CLASS = 'p-2 rounded-full transition-colors cursor-pointer'

const CHAIN_PILL_THEME: Record<string, ChainPillChain> = {
  celo: { icon: '🟢', iconUrl: ASSET_URLS.CELO_CHAIN_ICON, name: 'Celo' },
  solana: { icon: '🟣', iconUrl: ASSET_URLS.SOLANA_CHAIN_ICON, name: 'Solana' },
  stellar: { icon: '⚫', iconUrl: ASSET_URLS.STELLAR_CHAIN_ICON, name: 'Stellar' },
}

function chainPillChainFromKey(chainKey: string): ChainPillChain {
  const prefix = chainKey.toLowerCase().split(':')[0]
  return CHAIN_PILL_THEME[prefix] ?? CHAIN_PILL_THEME.stellar
}

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({
  address,
  className = '',
  hideWalletButton = false,
  infoUrl,
  isDark = false,
  labels,
  languageSelector,
  languageSelectorMobile,
  onDisconnect,
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
            onChange={onSelectCurrency}
            value={targetCurrency}
          />
        </div>
      )}
      {showChainPill && chainPillChain && (
        <ChainPill
          chain={chainPillChain}
          className="hidden md:flex"
          compact
          onClick={onOpenChainModal}
          tokenLabel={selectedTokenLabel}
        />
      )}
      {isConnected && !hideWalletButton && (
        <button
          aria-label={labels.walletDetailsAria}
          className="ab-nav-balance-pill flex shrink-0 items-center justify-center rounded-full border p-1.5 cursor-pointer"
          onClick={onWalletClick}
          type="button"
        >
          <div
            className="ab-nav-balance-dot h-2 w-2 shrink-0 rounded-full"
          />
        </button>
      )}
      {address && !hideWalletButton && (
        <>
          {onDisconnect && (
            <button
              aria-label={labels.disconnectAria ?? 'Desconectar billetera'}
              className={cn(NAV_BUTTON_CLASS, AB_STYLES.textSecondary)}
              onClick={() => { onDisconnect().catch(console.error) }}
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
        'ab-nav sticky top-0 z-[100] w-full border-b p-0 backdrop-blur-[6px]',
        className,
      )}
      role="navigation"
    >
      {/* Mobile: full width bar - only logo and connect button */}
      <div className="md:hidden px-4 py-1.5">
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
                className="rounded-xl bg-abroad-dark px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-abroad-dark-hover"
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
          {!isConnected && (
            <span className={cn('text-sm font-semibold', BRAND_TITLE_CLASS)}>Swap</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div>{languageSelector}</div>
          {!isConnected && (
            <button
              className="rounded-xl bg-abroad-dark px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-abroad-dark-hover"
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
