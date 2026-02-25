import {
  Info, Moon, Sun, User,
} from 'lucide-react'
import React, { memo } from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'
import { AB_STYLES, BRAND_TITLE_CLASS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

/* ── Props ── */

export interface NavBarResponsiveProps {
  address?: null | string
  balance: string
  balanceLoading: boolean
  className?: string
  infoUrl: string
  isDark?: boolean
  labels: {
    connectWallet: string
    connectWalletAria: string
    infoAriaLabel: string
    notConnected: string
    walletDetailsAria: string
  }
  languageSelector?: React.ReactNode
  languageSelectorMobile?: React.ReactNode
  onToggleTheme?: () => void
  onWalletClick: () => void
  walletInfo: {
    icon?: string
    name: string
  }
}

const NAV_BUTTON_CLASS = 'p-2 rounded-full transition-colors cursor-pointer'

const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({
  address,
  className = '',
  infoUrl,
  isDark = false,
  labels,
  languageSelector,
  languageSelectorMobile,
  onToggleTheme,
  onWalletClick,
}) => {
  const openInfo = () => window.open(infoUrl, '_blank', 'noopener,noreferrer')

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
    <nav className={`w-full ${className}`} role="navigation">
      {/* Mobile: rounded card with padding */}
      <div className="md:hidden px-4 pt-4">
        <div className={cn('max-w-8xl mx-auto rounded-2xl backdrop-blur-md', AB_STYLES.hoverBg)}>
          <div className="px-3 sm:px-6">
            <div className="flex items-center justify-between h-14">
              <div className="flex-shrink-0">
                <img
                  alt="Abroad"
                  className="h-7 w-auto"
                  src={isDark ? AbroadLogoWhite : AbroadLogoColored}
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="md:hidden">{languageSelectorMobile}</div>
                {actionButtons}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: Allbridge-style flat toolbar (64px) */}
      <div className={cn('hidden md:flex items-center justify-between h-16 px-6 w-full border-b border-ab-separator', AB_STYLES.cardBgOnly)}>
        <div className="flex items-center gap-8">
          <img
            alt="Abroad"
            className="h-7 w-auto flex-shrink-0"
            src={isDark ? AbroadLogoWhite : AbroadLogoColored}
          />
          <span className={cn('text-sm font-semibold', BRAND_TITLE_CLASS)}>
            Swap
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div>{languageSelector}</div>
          {actionButtons}
        </div>
      </div>
    </nav>
  )
}

export default memo(NavBarResponsive)
