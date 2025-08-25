import { Horizon } from '@stellar/stellar-sdk'
import { useTranslate } from '@tolgee/react'
import { Info, Wallet } from 'lucide-react'
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import AbroadLogoColored from '../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../assets/Logos/AbroadLogoWhite.svg'
import FreighterLogo from '../../assets/Logos/Wallets/Freighter.svg'
import HanaLogo from '../../assets/Logos/Wallets/Hana.svg'
import LobstrLogo from '../../assets/Logos/Wallets/Lobstr.svg'
import { useWalletAuth } from '../../contexts/WalletAuthContext'
import { kit } from '../../services/stellarKit'
import LanguageSelector from '../common/LanguageSelector'

/**
 * ----------------------------------------------------------------------------
 * Configuration
 * ----------------------------------------------------------------------------
 * Allow overrides via props while keeping safe defaults for mainnet USDC.
 */
const DEFAULT_HORIZON_URL = 'https://horizon.stellar.org'
const DEFAULT_USDC_ISSUER
  = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' // Circle USDC Issuer (mainnet)
const DEFAULT_INFO_URL = 'https://linktr.ee/Abroad.finance'

/**
 * ----------------------------------------------------------------------------
 * Utilities & Types
 * ----------------------------------------------------------------------------
 */
type ClassValue = false | null | string | undefined
const cn = (...classes: ClassValue[]) => classes.filter(Boolean).join(' ')

type AccountLike = {
  balances: BalanceLine[]
}

type BalanceLine = NativeBalance | NonNativeBalance

type NativeBalance = {
  asset_type: 'native'
  balance: string
}

type NonNativeBalance = {
  asset_code: string
  asset_issuer: string
  asset_type: string // 'credit_alphanum4' | 'credit_alphanum12'
  balance: string
}

type WalletKind
  = | 'freighter'
    | 'hana'
    | 'lobstr'
    | 'rabet'
    | 'stellar'
    | 'unknown'
    | 'xbull'

// Accept a translated fallback label to avoid calling hooks outside components
const formatWalletAddress = (address?: null | string, notConnectedLabel?: string) => {
  if (!address) return notConnectedLabel || 'No conectado'
  const trimmed = address.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

const formatFiat = (value: number | string) => {
  const n = typeof value === 'number' ? value : parseFloat(value || '0')
  if (!Number.isFinite(n)) return '0.00'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

const normalizeWalletKind = (id?: null | string): WalletKind => {
  if (!id) return 'unknown'
  const v = id.toLowerCase()
  if (v.includes('freighter')) return 'freighter'
  if (v.includes('hana')) return 'hana'
  if (v.includes('lobstr')) return 'lobstr'
  if (v.includes('xbull')) return 'xbull'
  if (v.includes('rabet')) return 'rabet'
  if (v.includes('stellar') || v.includes('trust')) return 'stellar'
  return 'unknown'
}

const walletPresentation: Record<
  WalletKind,
  { icon?: string, name: string }
> = {
  freighter: { icon: FreighterLogo, name: 'Freighter' },
  hana: { icon: HanaLogo, name: 'Hana' },
  lobstr: { icon: LobstrLogo, name: 'Lobstr' },
  rabet: { name: 'Rabet' },
  stellar: { name: 'Stellar Wallet' },
  unknown: { name: 'Stellar Wallet' },
  xbull: { name: 'xBull' },
}

/**
 * ----------------------------------------------------------------------------
 * Props
 * ----------------------------------------------------------------------------
 */
interface NavBarResponsiveProps {
  /** Additional classes for the outer nav container */
  className?: string
  /** Override the Horizon URL (useful for testnet or proxies) */
  horizonUrl?: string
  /** Override the info button URL */
  infoUrl?: string
  /** Custom handler to trigger a connect flow. If not provided, falls back to `kit.openModal` */
  onWalletConnect?: () => void
  /** Called when the user clicks the wallet while connected */
  onWalletDetails?: () => void
  /** Override the USDC issuer (e.g., testing assets) */
  usdcIssuer?: string
}

/**
 * Fetch the USDC balance for a Stellar account. Returns a numeric string (e.g., "12,345.67").
 * On failure or no trustline, returns "0.00". Distinguishes simple transient errors with "Error".
 */
async function fetchUSDCBalance(opts: {
  address: string
  horizonUrl: string
  usdcIssuer: string
}): Promise<string> {
  const { address, horizonUrl, usdcIssuer } = opts

  try {
    const server = new Horizon.Server(horizonUrl)
    const account = (await server.loadAccount(address)) as AccountLike

    const usdc = account.balances.find(
      (b: BalanceLine): b is NonNativeBalance =>
        b.asset_type !== 'native'
        && 'asset_code' in b
        && b.asset_code === 'USDC'
        && 'asset_issuer' in b
        && b.asset_issuer === usdcIssuer,
    )

    if (!usdc) return '0.00'
    return formatFiat(usdc.balance)
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Common cases: unfunded account / network blips.
    if (message.toLowerCase().includes('not found')) return '0.00'
    if (message.toLowerCase().includes('network')) return 'Error'

    // Default fallback
    return '0.00'
  }
}

/**
 * React hook to manage USDC balance with loading & refetch.
 * Avoids state updates after unmount and coalesces rapid refetches.
 */
function useUSDCBalance(
  address?: null | string,
  horizonUrl: string = DEFAULT_HORIZON_URL,
  usdcIssuer: string = DEFAULT_USDC_ISSUER,
) {
  const [balance, setBalance] = useState<string>('0.00')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<null | string>(null)
  const inFlight = useRef(0)

  const refetch = useCallback(async () => {
    if (!address) {
      setBalance('0.00')
      setError(null)
      return
    }

    const token = ++inFlight.current
    setLoading(true)
    setError(null)

    try {
      const b = await fetchUSDCBalance({ address, horizonUrl, usdcIssuer })
      if (token === inFlight.current) setBalance(b)
    }
    catch (e) {
      if (token === inFlight.current) {
        setError(e instanceof Error ? e.message : String(e))
        setBalance('0.00')
      }
    }
    finally {
      if (token === inFlight.current) setLoading(false)
    }
  }, [address, horizonUrl, usdcIssuer])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { balance, error, loading, refetch }
}

/**
 * ----------------------------------------------------------------------------
 * Component
 * ----------------------------------------------------------------------------
 */
const NavBarResponsive: React.FC<NavBarResponsiveProps> = ({
  className = '',
  horizonUrl = DEFAULT_HORIZON_URL,
  infoUrl = DEFAULT_INFO_URL,
  onWalletConnect,
  onWalletDetails,
  usdcIssuer = DEFAULT_USDC_ISSUER,
}) => {
  const { address, authenticateWithWallet, walletId } = useWalletAuth()
  const { t } = useTranslate()
  const { balance, loading } = useUSDCBalance(address, horizonUrl, usdcIssuer)

  /**
   * Handlers
   */
  const handleDirectWalletConnect = useCallback(() => {
    // Prefer a provided handler, else fall back to the kit modal.
    if (onWalletConnect) {
      onWalletConnect()
      return
    }

    try {
      kit?.openModal?.({
        onWalletSelected: async (option: { id: string }) => {
          await authenticateWithWallet(option.id)
        },
      })
    }
    catch {
      // As a last resort, do nothing rather than crash the UI.
    }
  }, [onWalletConnect, authenticateWithWallet])

  const handleWalletClick = useCallback(() => {
    if (address) {
      onWalletDetails?.()
    }
    else {
      handleDirectWalletConnect()
    }
  }, [address, onWalletDetails, handleDirectWalletConnect])

  /**
   * Presentational data
   */
  const walletInfo = useMemo(() => {
    const kind = normalizeWalletKind(walletId)
    return walletPresentation[kind]
  }, [walletId])

  /**
   * Render helpers
   */
  const WalletIcon = useMemo(() => {
    if (address && walletInfo.icon) {
      return (
        <img
          alt={`${walletInfo.name} wallet`}
          className="w-8 h-8"
          height={32}
          loading="lazy"
          src={walletInfo.icon}
          width={32}
        />
      )
    }
    return <Wallet aria-hidden="true" className="w-5 h-5 text-white" />
  }, [address, walletInfo])

  const USDCBadge = useCallback(
    (isMobile = false) => {
      // On desktop, hide when disconnected; on mobile, still show $0.00 to hint action.
      if (!address && !isMobile) return null

      const iconSize = 'w-4 h-4'
      const textSize = 'text-sm'
      const loadingSize = isMobile ? 'w-10 h-3' : 'w-12 h-4'
      const textColor = isMobile ? 'text-[#356E6A]' : 'text-white'
      const isError = balance === 'Error'

      return (
        <div
          aria-busy={loading}
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
          {loading && address
            ? (
                <div className={`${loadingSize} bg-white/20 rounded animate-pulse`} />
              )
            : (
                <span className={`${textColor} ${textSize} font-medium`}>
                  $
                  {address ? (isError ? '—' : balance) : '0.00'}
                </span>
              )}
        </div>
      )
    },
    [address, balance, loading],
  )

  const InfoButton = useCallback(
    (isMobile = false) => {
      const buttonClasses = isMobile
        ? 'p-2 rounded-full bg-[#356E6A]/5 hover:bg-[#356E6A]/10 transition-colors duration-200'
        : 'p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors duration-200'
      const iconColor = isMobile ? 'text-[#356E6A]' : 'text-white'

      return (
        <button
          aria-label={t('navbar.info_aria_label', 'Información de Abroad')}
          className={buttonClasses}
          onClick={() => {
            // Avoid SSR breaking on 'window'
            if (typeof window !== 'undefined') {
              window.open(infoUrl, '_blank', 'noopener,noreferrer')
            }
          }}
          type="button"
        >
          <Info aria-hidden="true" className={cn('w-5 h-5', iconColor)} />
        </button>
      )
    },
    [infoUrl, t],
  )

  /**
   * UI
   */
  return (
    <nav className={cn('w-full px-4 pt-4', className)} role="navigation">
      <div className="max-w-8xl mx-auto bg-transparent md:bg-[#356E6A]/5 backdrop-blur-md rounded-2xl">
        <div className="px-4 sm:px-6 lg:px-8">
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
              <LanguageSelector />
              {/* Wallet Badge */}
              <button
                aria-label={address ? t('navbar.wallet_details_aria', 'Ver detalles de la billetera') : t('navbar.connect_wallet_aria', 'Conectar billetera')}
                className="cursor-pointer flex items-center space-x-3 bg-white/20 backdrop-blur-sm rounded-xl px-4 py-2 hover:bg-white/30 transition-colors duration-200"
                onClick={handleWalletClick}
                type="button"
              >
                {WalletIcon}
                <span className="text-white text-md font-medium">
                  {address ? formatWalletAddress(address, t('navbar.not_connected', 'No conectado')) : t('navbar.connect_wallet', 'Conectar Billetera')}
                </span>
                {USDCBadge(false)}
              </button>

              {/* Info Icon */}
              {InfoButton(false)}
            </div>

            {/* Mobile Right Side */}
            <div className="md:hidden">
              <div className="flex items-center space-x-3">
                <LanguageSelector variant="mobile" />
                <button
                  aria-label={address ? t('navbar.wallet_details_aria', 'Ver detalles de la billetera') : t('navbar.connect_wallet_aria', 'Conectar billetera')}
                  className="flex items-center justify-center bg-[#356E6A]/5 backdrop-blur-xl rounded-xl px-4 py-2 border border-white/30 hover:bg-white/30 transition-colors duration-200 flex-1"
                  onClick={handleWalletClick}
                  type="button"
                >
                  {/* When not connected show an explicit connect CTA; when connected show balance badge */}
                  {address
                    ? (
                        USDCBadge(true)
                      )
                    : (
                        <div className="flex items-center space-x-2">
                          <Wallet aria-hidden="true" className="w-5 h-5 text-[#356E6A]" />
                          <span className="text-[#356E6A] text-sm font-medium">{t('navbar.connect_wallet', 'Conectar Billetera')}</span>
                        </div>
                      )}
                </button>
                {/* (Optional) Show info button on mobile too. Comment out if undesired. */}
                {/* {InfoButton(true)} */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}

export default memo(NavBarResponsive)
