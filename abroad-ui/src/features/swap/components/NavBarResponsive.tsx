import { Info, User, Wallet } from 'lucide-react'
import React, { memo } from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'

/**
 * ----------------------------------------------------------------------------
 * Utilities & Types
 * ----------------------------------------------------------------------------
 */
type ClassValue = false | null | string | undefined
const cn = (...classes: ClassValue[]) => classes.filter(Boolean).join(' ')

// Accept a translated fallback label to avoid calling hooks outside components
const formatWalletAddress = (address?: null | string, notConnectedLabel?: string) => {
  if (!address) return notConnectedLabel || 'No conectado'
  const trimmed = address.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

/**
 * ----------------------------------------------------------------------------
 * Props
 * ----------------------------------------------------------------------------
 */
export interface NavBarResponsiveProps {
  address?: null | string
  balance: string
  balanceLoading: boolean
  className?: string
  infoUrl: string
  labels: {
    connectWallet: string
    connectWalletAria: string
    infoAriaLabel: string
    notConnected: string
    walletDetailsAria: string
  }
  /** Desktop language selector slot */
  languageSelector?: React.ReactNode
  /** Mobile language selector slot */
  languageSelectorMobile?: React.ReactNode
  onWalletClick: () => void
  walletInfo: {
    icon?: string
    name: string
  }
}

/**
 * Fetch the USDC balance for a Stellar account. Returns a numeric string (e.g., "12,345.67").
 * On failure or no trustline, returns "0.00". Distinguishes simple transient errors with "Error".
 */
const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({
  address,
  balance,
  balanceLoading,
  className = '',
  infoUrl,
  labels,
  languageSelector,
  languageSelectorMobile,
  onWalletClick,
  walletInfo,
}) => {
  const WalletIcon = address && walletInfo.icon
    ? (
      <img
        alt={`${walletInfo.name} wallet`}
        className="w-8 h-8"
        height={32}
        loading="lazy"
        src={walletInfo.icon}
        width={32}
      />
    )
    : <Wallet aria-hidden="true" className="w-5 h-5 text-white" />

  const renderUSDCBadge = (isMobile = false) => {
    if (!address && !isMobile) return null
    const iconSize = 'w-4 h-4'
    const textSize = 'text-sm'
    const loadingSize = isMobile ? 'w-10 h-3' : 'w-12 h-4'
    const textColor = isMobile ? 'text-[#356E6A]' : 'text-white'
    const isError = balance === 'Error'
    return (
      <div
        aria-busy={balanceLoading}
        aria-live="polite"
        className="flex items-center space-x-1 bg-white/30 rounded-lg px-2 py-1"
        title={isError ? 'Network error while fetching balance' : 'USDC balance'}
      >
        <img
          alt="USDC"
          className={iconSize}
          height={16}
          loading="lazy"
          src="https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg"
          width={16}
        />
        {balanceLoading && address
          ? <div className={`${loadingSize} bg-white/20 rounded animate-pulse`} />
          : (
            <span className={`${textColor} ${textSize} font-medium`}>
              $
              {address ? (isError ? '—' : balance) : '0.00'}
            </span>
          )}
      </div>
    )
  }

  const renderInfoButton = (isMobile = false) => {
    const buttonClasses = isMobile
      ? 'p-2 rounded-full bg-[#356E6A]/5 hover:bg-[#356E6A]/10 transition-colors duration-200'
      : 'p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200'
    const iconColor = isMobile ? 'text-[#356E6A]' : 'text-white'
    return (
      <button
        aria-label={labels.infoAriaLabel}
        className={buttonClasses}
        onClick={() => { if (typeof window !== 'undefined') window.open(infoUrl, '_blank', 'noopener,noreferrer') }}
        type="button"
      >
        <Info aria-hidden="true" className={cn('w-5 h-5', iconColor)} />
      </button>
    )
  }

  return (
    <nav className={cn('w-full px-4 pt-4', className)} role="navigation">
      <div className="max-w-8xl mx-auto bg-transparent md:bg-[#356E6A]/5 backdrop-blur-md rounded-2xl">
        <div className="sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex-shrink-0">
              {/* Mobile Logo - Colored */}
              <img
                alt="Abroad"
                className="h-8 w-auto md:hidden"
                height={32}
                src={AbroadLogoColored}
                width={32}
              />
              {/* Desktop Logo - White */}
              <img
                alt="Abroad"
                className="h-8 w-auto hidden md:block"
                height={32}
                src={AbroadLogoWhite}
                width={32}
              />
            </div>

            {/* Desktop Right Side */}
            <div className="hidden md:flex items-center space-x-4">
              {languageSelector}
              {address && (
                <button
                  className="bg-white/90 backdrop-blur-xl rounded-xl p-2 flex items-center justify-center hover:bg-white transition-all shadow-sm ring-1 ring-black/5 active:scale-95 cursor-pointer"
                  onClick={onWalletClick}
                  type="button"
                >
                  <User className="w-5 h-5 text-abroad-dark" />
                </button>
              )}
              <button
                aria-label={address ? labels.walletDetailsAria : labels.connectWalletAria}
                className="cursor-pointer flex items-center space-x-3 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2 hover:bg-white/30 transition-colors duration-200"
                onClick={onWalletClick}
                type="button"
              >
                {WalletIcon}
                <span className="text-white text-md font-medium">
                  {address ? formatWalletAddress(address, labels.notConnected) : labels.connectWallet}
                </span>
                {renderUSDCBadge(false)}
              </button>
              {renderInfoButton(false)}
            </div>

            {/* Mobile Right Side */}
            <div className="md:hidden">
              <div className="flex items-center space-x-3">

                {address && (
                  <button
                    className="bg-white/90 backdrop-blur-xl rounded-xl p-2 flex items-center justify-center hover:bg-white transition-all shadow-sm ring-1 ring-black/5 active:scale-95 cursor-pointer"
                    onClick={onWalletClick}
                    type="button"
                  >
                    <User className="w-5 h-5 text-[#356E6A]" />
                  </button>
                )}
                <button
                  aria-label={address ? labels.walletDetailsAria : labels.connectWalletAria}
                  className="flex items-center justify-center bg-[#356E6A]/5 backdrop-blur-xl rounded-xl pl-2 pr-1 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200 flex-1"
                  onClick={onWalletClick}
                  type="button"
                >
                  {address
                    ? renderUSDCBadge(true)
                    : (
                      <div className="flex items-center space-x-2">
                        <Wallet aria-hidden="true" className="w-5 h-5 text-[#356E6A]" />
                        <span className="text-[#356E6A] text-sm font-medium">{labels.connectWallet}</span>
                      </div>
                    )}
                </button>
                {languageSelectorMobile}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default memo(NavBarResponsive)
