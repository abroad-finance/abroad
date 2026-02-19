import { Info, Moon, Sun, User } from 'lucide-react'
import React, { memo } from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'

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
  return (
    <nav className={`w-full px-4 pt-4 ${className}`} role="navigation">
      <div
        className="max-w-8xl mx-auto rounded-2xl backdrop-blur-md"
        style={{ background: 'var(--ab-hover)' }}
      >
        <div className="px-3 sm:px-6">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex-shrink-0">
              <img
                alt="Abroad"
                className="h-7 w-auto"
                src={isDark ? AbroadLogoWhite : AbroadLogoColored}
              />
            </div>

            {/* Right Side */}
            <div className="flex items-center gap-2">
              {/* Language selector */}
              <div className="hidden md:block">{languageSelector}</div>
              <div className="md:hidden">{languageSelectorMobile}</div>

              {/* Theme toggle */}
              {onToggleTheme && (
                <button
                  aria-label="Toggle theme"
                  className="p-2 rounded-full transition-colors cursor-pointer"
                  onClick={onToggleTheme}
                  style={{ color: 'var(--ab-text-secondary)' }}
                  type="button"
                >
                  {isDark ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
                </button>
              )}

              {/* User button (when connected) */}
              {address && (
                <button
                  aria-label={labels.walletDetailsAria}
                  className="p-2 rounded-full transition-colors cursor-pointer"
                  onClick={onWalletClick}
                  style={{ background: 'var(--ab-badge-bg)', border: '1px solid var(--ab-badge-border)' }}
                  type="button"
                >
                  <User className="w-4 h-4" style={{ color: 'var(--ab-text)' }} />
                </button>
              )}

              {/* Info button */}
              <button
                aria-label={labels.infoAriaLabel}
                className="p-2 rounded-full transition-colors cursor-pointer"
                onClick={() => window.open(infoUrl, '_blank', 'noopener,noreferrer')}
                style={{ color: 'var(--ab-text-secondary)' }}
                type="button"
              >
                <Info aria-hidden="true" className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default memo(NavBarResponsive)
