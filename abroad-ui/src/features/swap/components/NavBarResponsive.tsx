import { Info, Moon, Sun, User, Wallet } from 'lucide-react'
import React, { memo } from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'

/* ── Utils ── */

const formatWalletAddress = (address?: null | string, notConnectedLabel?: string) => {
  if (!address) return notConnectedLabel || 'No conectado'
  const trimmed = address.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

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
  balance,
  balanceLoading,
  className = '',
  infoUrl,
  isDark = false,
  labels,
  languageSelector,
  languageSelectorMobile,
  onToggleTheme,
  onWalletClick,
  walletInfo,
}) => {
  const WalletIcon = address && walletInfo.icon
    ? (
        <img
          alt={`${walletInfo.name} wallet`}
          className="w-7 h-7"
          height={28}
          loading="lazy"
          src={walletInfo.icon}
          width={28}
        />
      )
    : <Wallet aria-hidden="true" className="w-4.5 h-4.5" style={{ color: 'var(--ab-text)' }} />

  const renderBalance = () => {
    if (!address) return null
    const isError = balance === 'Error'
    return (
      <div
        aria-busy={balanceLoading}
        aria-live="polite"
        className="flex items-center gap-1 rounded-lg px-2 py-0.5"
        style={{ background: 'var(--ab-hover)' }}
      >
        <img
          alt="USDC"
          className="w-4 h-4"
          src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
        />
        {balanceLoading
          ? <div className="w-10 h-3 rounded animate-pulse" style={{ background: 'var(--ab-separator)' }} />
          : (
              <span className="text-xs font-medium" style={{ color: 'var(--ab-text)' }}>
                ${isError ? '—' : balance}
              </span>
            )}
      </div>
    )
  }

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
                  className="p-2 rounded-full transition-colors cursor-pointer"
                  onClick={onWalletClick}
                  style={{ background: 'var(--ab-badge-bg)', border: '1px solid var(--ab-badge-border)' }}
                  type="button"
                >
                  <User className="w-4 h-4" style={{ color: 'var(--ab-text)' }} />
                </button>
              )}

              {/* Wallet button */}
              <button
                aria-label={address ? labels.walletDetailsAria : labels.connectWalletAria}
                className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors cursor-pointer"
                onClick={onWalletClick}
                style={{ background: 'var(--ab-badge-bg)', border: '1px solid var(--ab-badge-border)' }}
                type="button"
              >
                {WalletIcon}
                <span className="text-sm font-medium hidden sm:inline" style={{ color: 'var(--ab-text)' }}>
                  {address ? formatWalletAddress(address, labels.notConnected) : labels.connectWallet}
                </span>
                {renderBalance()}
              </button>

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
