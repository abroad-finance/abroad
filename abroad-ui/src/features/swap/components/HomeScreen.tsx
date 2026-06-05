import { useTranslate } from '@tolgee/react'
import {
  ChevronDown, ChevronRight, Keyboard, Lock, PiggyBank, QrCode, Store, Wallet, Zap,
} from 'lucide-react'
import React from 'react'

import type { OnboardingRates } from '@/features/swap/types'

import { CurrencyToggle } from '@/components/ui'
import {
  CHAIN_CONFIG_ARRAY, CHAIN_MAP, COUNTRIES, CURRENCY_FLAG_URL, RECENT_COUNTRY_CONFIG, TOKEN_ICONS,
} from '@/shared/constants'
import {
  cn, isApiTxExpired, localeForCurrency, numberFormatOptions,
} from '@/shared/utils'

import { _36EnumsTargetCurrency as TargetCurrency, type TransactionListItem } from '../../../api'
import BreBLogo from '../../../assets/Logos/networks/Bre-b.svg'

// Alias for backwards compatibility
const CHAIN_CONFIG = CHAIN_CONFIG_ARRAY
const TOKEN_ICON_URL = TOKEN_ICONS

const RAIL_LOGO: Record<string, string> = {
  BRL: '/pix-white.svg',
  COP: BreBLogo,
}

const TRUST_BADGE_DATA = [
  { defaultLabel: '< 3s settlement', i18nKey: 'home.trust_settlement' as const, Icon: Zap },
  { defaultLabel: 'Low fees', i18nKey: 'home.trust_fees' as const, Icon: PiggyBank },
  { defaultLabel: 'Non-custodial', i18nKey: 'home.trust_custodial' as const, Icon: Lock },
]

export interface HomeScreenProps {
  balance: string
  formatDate?: (dateString: string) => string
  getStatusStyle?: (status: string) => string
  getStatusText?: (status: string) => string
  hasEnteredApp?: boolean
  isAuthenticated: boolean
  onboardingRates?: OnboardingRates
  onEnterApp?: () => void
  onGoToManual: () => void
  onHistoryClick: () => void
  onOpenChainModal?: () => void
  onOpenQr: () => void
  onRequestConnect: () => void
  onSelectCurrency?: (currency: TargetCurrency) => void
  onSelectTransaction?: (tx: TransactionListItem) => void
  recentTransactions: TransactionListItem[]
  selectedChainKey?: string
  selectedTokenLabel: string
  targetCurrency: TargetCurrency
}

export default function HomeScreen({
  balance,
  formatDate,
  getStatusStyle,
  getStatusText,
  hasEnteredApp = false,
  isAuthenticated,
  onboardingRates,
  onEnterApp,
  onGoToManual,
  onHistoryClick,
  onOpenChainModal,
  onOpenQr,
  onRequestConnect,
  onSelectCurrency,
  onSelectTransaction,
  recentTransactions,
  selectedChainKey,
  selectedTokenLabel,
  targetCurrency,
}: Readonly<HomeScreenProps>): React.JSX.Element {
  const { t } = useTranslate()
  const balanceNum = Number.parseFloat(balance.replace(/,/g, '')) || 0

  // Show onboarding view for non-authenticated users who haven't entered the app
  const showOnboarding = !isAuthenticated && !hasEnteredApp

  // Format rate for display
  const formatRate = (rate: null | number, decimals: number): string => {
    if (rate === null) return '--'
    return rate.toLocaleString(decimals === 0 ? 'es-CO' : 'pt-BR', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    })
  }

  // Onboarding view - Figma node 5:2 pixel-perfect
  if (showOnboarding) {
    const trustBadges = TRUST_BADGE_DATA.map(({ defaultLabel, i18nKey, Icon }) => ({
      Icon,
      label: t(i18nKey, defaultLabel),
    }))

    return (
      <main className="flex w-full h-full flex-col items-center justify-center px-4 overflow-hidden">
        <div className="flex w-full max-w-[min(90vw,667px)] flex-col items-center justify-center">
          {/* Live badge – Figma 5:13 */}
          <div className="ab-hero-live-badge mb-[clamp(0.5rem,2vh,1rem)] flex shrink-0 items-center gap-2 rounded-full px-[clamp(0.75rem,2vw,1rem)] py-[clamp(0.25rem,1vh,0.375rem)]">
            <span className="ab-hero-live-dot h-[clamp(0.375rem,1.5vh,0.5rem)] w-[clamp(0.375rem,1.5vh,0.5rem)] shrink-0 rounded-full animate-pulse" />
            <span className="ab-hero-live-text text-[clamp(0.75rem,1.5vw+0.5vh,0.875rem)] font-medium leading-tight">
              {t('home.live_badge', 'Live in Colombia & Brazil')}
            </span>
          </div>

          {/* Headline – Figma 5:20 */}
          <h1 className="mb-[clamp(0.5rem,2vh,1rem)] text-center text-[clamp(1.75rem,4vw+2vh,3.75rem)] font-extrabold leading-[1.1] tracking-[-0.02em]">
            <span className="ab-hero-heading-dark">
              {t('home.headline_1', 'Spend your stablecoins at')}
              <br />
            </span>
            <br />
            <span className="ab-hero-heading-accent">
              {t('home.headline_2', 'local merchants.')}
            </span>
          </h1>

          {/* Subline – Figma 5:22 */}
          <p className="ab-hero-subline mb-[clamp(0.75rem,2.5vh,1.5rem)] max-w-[min(85vw,461px)] text-center text-[clamp(0.875rem,2vw+0.5vh,1.25rem)] font-normal leading-[1.4]">
            {t('home.subline', 'Connect your wallet, scan a QR code, and pay — the merchant receives local currency instantly.')}
          </p>

          {/* Chain badges – Figma 5:24 */}
          <div className="mb-[clamp(0.75rem,2.5vh,1.5rem)] flex shrink-0 flex-wrap items-center justify-center gap-[clamp(0.5rem,1.5vh,0.75rem)]">
            {CHAIN_CONFIG.map(({ icon, key, label }) => (
              <div
                className={cn(
                  'flex items-center gap-[clamp(0.25rem,1vw,0.5rem)] self-stretch rounded-full px-[clamp(0.5rem,2vw,1rem)] py-[clamp(0.25rem,1vh,0.35rem)]',
                  key === 'celo' && 'ab-hero-chain-celo',
                  key === 'solana' && 'ab-hero-chain-solana',
                  key === 'stellar' && 'ab-hero-chain-stellar',
                )}
                key={key}
              >
                <img
                  alt={label}
                  className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0 object-contain"
                  src={icon}
                />
                <span
                  className={cn(
                    'text-center text-[clamp(0.75rem,1.5vw+0.5vh,0.875rem)] font-medium leading-tight',
                    key === 'celo' && 'ab-hero-chain-celo-text',
                    key === 'solana' && 'ab-hero-chain-solana-text',
                    key === 'stellar' && 'ab-hero-chain-stellar-text',
                  )}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Exchange Rates Section */}
          {onboardingRates && (
            <div className="mb-[clamp(0.5rem,2vh,1rem)] w-full max-w-[min(85vw,400px)]">
              <p className="ab-hero-subline text-center text-[clamp(0.75rem,1.5vw+0.5vh,0.875rem)] font-medium mb-[clamp(0.25rem,1vh,0.75rem)]">
                {t('home.exchange_rates', 'Live Exchange Rates')}
              </p>
              <div className="grid grid-cols-2 gap-[clamp(0.5rem,1.5vw,0.75rem)]">
                {/* COP Rates */}
                <div className="rounded-[clamp(0.75rem,2vh,1rem)] border border-[var(--ab-border)] bg-[var(--ab-card)] p-[clamp(0.5rem,1.5vh,0.75rem)]">
                  <div className="flex items-center gap-[clamp(0.25rem,1vw,0.5rem)] mb-[clamp(0.25rem,1vh,0.5rem)]">
                    <img
                      alt="Colombia"
                      className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] rounded-full object-cover"
                      src={CURRENCY_FLAG_URL.COP}
                    />
                    <span className="text-[clamp(0.7rem,1.5vw,0.75rem)] font-semibold text-[var(--ab-text-secondary)]">COP</span>
                  </div>
                  <div className="space-y-[clamp(0.125rem,0.75vh,0.375rem)]">
                    <div className="flex items-center gap-[clamp(0.25rem,1vw,0.375rem)]">
                      <img alt="USDC" className="h-[clamp(0.875rem,2vh,1rem)] w-[clamp(0.875rem,2vh,1rem)]" src={TOKEN_ICON_URL.USDC} />
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] text-[var(--ab-text-muted)]">{t('home.rate_usdc', '1 USDC =')}</span>
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] font-semibold text-[var(--ab-text)]">
                        $
                        {formatRate(onboardingRates.cop.USDC, 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-[clamp(0.25rem,1vw,0.375rem)]">
                      <img alt="USDT" className="h-[clamp(0.875rem,2vh,1rem)] w-[clamp(0.875rem,2vh,1rem)]" src={TOKEN_ICON_URL.USDT} />
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] text-[var(--ab-text-muted)]">{t('home.rate_usdt', '1 USDT =')}</span>
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] font-semibold text-[var(--ab-text)]">
                        $
                        {formatRate(onboardingRates.cop.USDT, 0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* BRL Rates */}
                <div className="rounded-[clamp(0.75rem,2vh,1rem)] border border-[var(--ab-border)] bg-[var(--ab-card)] p-[clamp(0.5rem,1.5vh,0.75rem)]">
                  <div className="flex items-center gap-[clamp(0.25rem,1vw,0.5rem)] mb-[clamp(0.25rem,1vh,0.5rem)]">
                    <img
                      alt="Brazil"
                      className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] rounded-full object-cover"
                      src={CURRENCY_FLAG_URL.BRL}
                    />
                    <span className="text-[clamp(0.7rem,1.5vw,0.75rem)] font-semibold text-[var(--ab-text-secondary)]">BRL</span>
                  </div>
                  <div className="space-y-[clamp(0.125rem,0.75vh,0.375rem)]">
                    <div className="flex items-center gap-[clamp(0.25rem,1vw,0.375rem)]">
                      <img alt="USDC" className="h-[clamp(0.875rem,2vh,1rem)] w-[clamp(0.875rem,2vh,1rem)]" src={TOKEN_ICON_URL.USDC} />
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] text-[var(--ab-text-muted)]">{t('home.rate_usdc', '1 USDC =')}</span>
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] font-semibold text-[var(--ab-text)]">
                        R$
                        {formatRate(onboardingRates.brl.USDC, 2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-[clamp(0.25rem,1vw,0.375rem)]">
                      <img alt="USDT" className="h-[clamp(0.875rem,2vh,1rem)] w-[clamp(0.875rem,2vh,1rem)]" src={TOKEN_ICON_URL.USDT} />
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] text-[var(--ab-text-muted)]">{t('home.rate_usdt', '1 USDT =')}</span>
                      <span className="text-[clamp(0.65rem,1.5vw,0.75rem)] font-semibold text-[var(--ab-text)]">
                        R$
                        {formatRate(onboardingRates.brl.USDT, 2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CTA Button – Figma 5:36 */}
          <button
            className="ab-hero-cta mb-[clamp(0.5rem,1.5vh,1rem)] flex shrink-0 items-center justify-center gap-[clamp(0.25rem,1vw,0.5rem)] rounded-[clamp(0.75rem,2vh,1rem)] px-[clamp(1.5rem,4vw,2rem)] py-[clamp(0.5rem,1.5vh,1rem)] font-bold text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
            onClick={onEnterApp}
            type="button"
          >
            <span className="text-[clamp(1rem,2.5vw+1vh,1.125rem)] leading-tight">
              {t('home.cta_continue', 'Continue')}
            </span>
            <ChevronRight className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0" />
          </button>

          {/* Trust badges – Figma 5:41 */}
          <div className="ab-hero-subline flex w-full flex-nowrap items-center justify-center gap-[clamp(0.5rem,2vw,2rem)]">
            {trustBadges.map(({ Icon, label }) => (
              <div
                className="flex shrink-0 items-center gap-[clamp(0.25rem,1vw,0.5rem)]"
                key={label}
              >
                <Icon className="h-[clamp(0.75rem,2vh,0.875rem)] w-[clamp(0.75rem,2vh,0.875rem)] shrink-0" strokeWidth={2} />
                <span className="whitespace-nowrap text-center text-[clamp(0.7rem,1.5vw+0.5vh,0.875rem)] font-medium leading-tight">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  // Dashboard view - Guest mode or Authenticated – Figma 1:3 / 1:42 pixel-perfect
  const c = targetCurrency === TargetCurrency.BRL ? COUNTRIES.BRL : COUNTRIES.COP
  const localBalance = c.decimals === 0
    ? Math.round(balanceNum * c.rate).toLocaleString('es-CO')
    : (balanceNum * c.rate).toFixed(c.decimals)

  const chainKey = selectedChainKey?.toLowerCase().split(':')[0] ?? 'stellar'
  const chainInfo = CHAIN_MAP[chainKey] ?? CHAIN_MAP.stellar

  // Helper to check if we should show transactions section.
  // Only the user's own (scoped) transactions are shown — never partner-wide data.
  const hasTransactions = isAuthenticated && recentTransactions.length > 0

  return (
    <div className="flex w-full h-full flex-col items-center px-0 overflow-y-auto">
      <div className="w-full max-w-[min(90vw,576px)]">
        {/* Balance - Figma 1:46 */}
        <div className="flex flex-col items-center gap-[clamp(0.25rem,1vh,0.5rem)] py-[clamp(0.25rem,1vh,0.5rem)]">
          <p className="text-center text-[clamp(0.65rem,1.5vw,0.75rem)] font-bold uppercase leading-tight tracking-[1.2px] text-[var(--ab-text-muted)]">
            {t('home.your_balance', 'Your Balance')}
          </p>
          <div className="flex items-center justify-center gap-[clamp(0.5rem,2vw,0.75rem)]">
            {TOKEN_ICON_URL[selectedTokenLabel]
              ? (
                  <img
                    alt={selectedTokenLabel}
                    className={cn(
                      'h-[clamp(1.5rem,4vh,2rem)] w-[clamp(1.5rem,4vh,2rem)] shrink-0 self-center object-contain',
                      !isAuthenticated && 'opacity-50 grayscale',
                    )}
                    src={TOKEN_ICON_URL[selectedTokenLabel]}
                  />
                )
              : (
                  <span className={cn(
                    'text-[clamp(1.25rem,3vh,1.875rem)] font-medium leading-tight',
                    isAuthenticated ? 'text-[var(--ab-green)]' : 'text-[var(--ab-text-muted)]',
                  )}
                  >
                    {selectedTokenLabel}
                  </span>
                )}
            <span className={cn(
              'text-center text-[clamp(2rem,6vh,3.75rem)] font-black leading-[1.1]',
              isAuthenticated ? 'text-[var(--ab-text)]' : 'text-[var(--ab-text-muted)]',
            )}
            >
              $
              {isAuthenticated ? balance : '--'}
            </span>
          </div>
          <div className="flex items-center justify-center pt-[clamp(0.125rem,0.5vh,0.25rem)]">
            <div className="flex items-center gap-[clamp(0.25rem,1vw,0.5rem)] rounded-full border border-[var(--ab-border)] bg-[var(--ab-card)] px-[clamp(0.5rem,1.5vw,0.75rem)] py-[clamp(0.25rem,0.75vh,0.25rem)] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
              {CURRENCY_FLAG_URL[targetCurrency] && (
                <img
                  alt={targetCurrency}
                  className={cn(
                    'h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0 object-contain',
                    !isAuthenticated && 'opacity-50 grayscale',
                  )}
                  src={CURRENCY_FLAG_URL[targetCurrency]}
                />
              )}
              <span className="text-[clamp(0.75rem,1.5vw+0.5vh,0.875rem)] font-medium leading-tight text-[var(--ab-text-muted)]">
                ≈
                {targetCurrency === TargetCurrency.BRL ? ' R$' : ' $'}
                {isAuthenticated ? localBalance : '--'}
                {' '}
                {targetCurrency}
              </span>
            </div>
          </div>
        </div>

        {/* Chain + currency toggle - Figma 9:332 / 9:368 */}
        <div className="mt-[clamp(0.5rem,2vh,1rem)] flex flex-wrap items-center justify-center gap-[clamp(0.25rem,1vw,0.5rem)]">
          {onOpenChainModal && (
            <button
              className={cn(
                'flex items-center gap-2 rounded-full border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-[13px] py-[7px] transition-colors hover:opacity-90',
                !isAuthenticated && 'cursor-not-allowed opacity-70',
              )}
              onClick={isAuthenticated ? onOpenChainModal : onRequestConnect}
              type="button"
            >
              <img
                alt={chainInfo.name}
                className={cn('h-5 w-5', !isAuthenticated && 'opacity-50 grayscale')}
                src={chainInfo.icon}
              />
              <span className="text-xs font-semibold text-[var(--ab-text-secondary)]">
                {selectedTokenLabel}
                {' '}
                on
                {' '}
                {chainInfo.name}
              </span>
              <ChevronDown className="h-4 w-4 text-[var(--ab-text-secondary)]" />
            </button>
          )}
          {onSelectCurrency && (
            <CurrencyToggle
              onChange={c => onSelectCurrency(c)}
              value={targetCurrency}
            />
          )}
        </div>

        {/* Payment cards - Figma 1:71, 2 cols equal height, responsive */}
        <div className="mt-[clamp(0.75rem,2.5vh,1.5rem)] grid grid-cols-2 gap-[clamp(0.5rem,1.5vw,0.75rem)] items-stretch">
          <button
            className={cn(
              'flex h-full min-h-[clamp(100px,18vh,140px)] w-full flex-col items-center justify-center gap-[clamp(0.25rem,1vh,0.5rem)] rounded-[clamp(1rem,3vh,1.5rem)] p-[clamp(0.75rem,2vh,1rem)] text-center transition-all',
              isAuthenticated
                ? 'bg-[#3ca383] shadow-[0px_0px_15px_0px_rgba(16,185,129,0.3)] hover:opacity-95'
                : 'bg-[#3ca383]/80 hover:bg-[#3ca383]',
            )}
            onClick={onOpenQr}
            type="button"
          >
            <div className="flex h-[clamp(2.5rem,8vh,4rem)] w-[clamp(2.5rem,8vh,4rem)] shrink-0 items-center justify-center rounded-[clamp(0.5rem,1.5vh,0.875rem)] bg-white/20 backdrop-blur-[2px]">
              <QrCode className="h-full w-full p-[clamp(0.375rem,1.5vh,0.5rem)] text-white" strokeWidth={1.5} />
            </div>
            <span className="text-[clamp(0.8rem,2vw+0.5vh,1.125rem)] font-bold leading-tight text-white">
              {t('home.scan_to_pay', 'Scan to Pay')}
            </span>
            <img
              alt={targetCurrency === TargetCurrency.BRL ? 'PIX' : 'Bre-B'}
              className="h-[clamp(0.875rem,2.5vh,1rem)] w-auto shrink-0"
              src={RAIL_LOGO[targetCurrency]}
            />
          </button>

          <button
            className={cn(
              'flex h-full min-h-[clamp(100px,18vh,140px)] w-full flex-col items-center justify-center gap-[clamp(0.25rem,1vh,0.5rem)] rounded-[clamp(1rem,3vh,1.5rem)] p-[clamp(0.75rem,2vh,1rem)] text-center transition-all',
              isAuthenticated
                ? 'bg-[var(--ab-bg-card)] shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_-1px_rgba(0,0,0,0.02)] hover:shadow-md'
                : 'bg-[var(--ab-bg-subtle)] border border-[var(--ab-border)]',
            )}
            onClick={onGoToManual}
            type="button"
          >
            <div className="flex h-[clamp(2.5rem,8vh,4rem)] w-[clamp(2.5rem,8vh,4rem)] shrink-0 items-center justify-center rounded-[clamp(0.5rem,1.5vh,0.875rem)] bg-[var(--ab-bg-subtle)]">
              <Keyboard
                className="h-full w-full p-[clamp(0.375rem,1.5vh,0.5rem)] text-[var(--ab-text-secondary)]"
                strokeWidth={1.5}
              />
            </div>
            <span className="text-[clamp(0.8rem,2vw+0.5vh,1.125rem)] font-bold leading-tight text-[var(--ab-text)]">
              {t('home.manual_payment', 'Manual Payment')}
            </span>
          </button>
        </div>

        {/* Connect wallet hint - shown when not authenticated */}
        {!isAuthenticated && (
          <div className="mt-[clamp(0.75rem,2.5vh,1.5rem)] flex justify-center">
            <button
              className="ab-hero-cta flex items-center gap-[clamp(0.25rem,1vw,0.5rem)] rounded-[clamp(0.75rem,2vh,1rem)] px-[clamp(1rem,3vw,1.5rem)] py-[clamp(0.5rem,1.5vh,0.75rem)] font-bold text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
              onClick={onRequestConnect}
              type="button"
            >
              <Wallet className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)]" />
              <span className="text-[clamp(0.875rem,2vw+0.5vh,1rem)] leading-tight">
                {t('home.cta_connect', 'Connect Wallet')}
              </span>
              <ChevronRight className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0" />
            </button>
          </div>
        )}

        {/* Recent transactions - only when authenticated */}
        {hasTransactions && (
          <div className="mt-[clamp(0.5rem,2vh,1rem)] flex-1 min-h-0 overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase leading-4 tracking-[1.2px] text-[var(--ab-text-muted)]">
                {t('home.recent', 'Recent')}
              </span>
              <button
                className="text-sm font-medium leading-5 text-[var(--ab-green)]"
                onClick={onHistoryClick}
                type="button"
              >
                {t('home.see_all', 'See all')}
              </button>
            </div>
            <div className="divide-y divide-[var(--ab-border)] overflow-hidden rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-card)]">
              {recentTransactions.slice(0, 2).map((tx) => {
                const countryConfig = RECENT_COUNTRY_CONFIG[tx.quote.targetCurrency] ?? RECENT_COUNTRY_CONFIG.COP
                const isExpired = isApiTxExpired(tx.status)
                const localAmount = tx.quote.targetAmount.toLocaleString(
                  localeForCurrency(tx.quote.targetCurrency),
                  numberFormatOptions(tx.quote.targetCurrency),
                )
                return (
                  <button
                    className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[var(--ab-bg-subtle)]"
                    key={tx.id}
                    onClick={() => (onSelectTransaction ? onSelectTransaction(tx) : onHistoryClick())}
                    type="button"
                  >
                    <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)]">
                      <Store className="h-3.5 w-3.5 text-[var(--ab-text-muted)]" strokeWidth={1.5} />
                      <img
                        alt={countryConfig.currency}
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-[var(--ab-bg-card)] object-cover shadow-sm"
                        src={countryConfig.flagUrl}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          'text-sm font-semibold',
                          isExpired ? 'text-[var(--ab-text-muted)] line-through' : 'text-[var(--ab-text)]',
                        )}
                      >
                        {tx.accountNumber}
                      </div>
                      {formatDate && (
                        <div className="mt-0.5 text-xs text-[var(--ab-text-muted)]">
                          {formatDate(tx.createdAt)}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <div
                        className={cn(
                          'flex items-center gap-1 text-sm font-semibold',
                          isExpired ? 'text-[var(--ab-text-muted)] line-through' : 'text-[var(--ab-text)]',
                        )}
                      >
                        {countryConfig.symbol}
                        {localAmount}
                        <img alt={countryConfig.currency} className="h-3 w-3 rounded-full" src={countryConfig.flagUrl} />
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-[var(--ab-text-muted)]">
                        $
                        {tx.quote.sourceAmount.toFixed(2)}
                        <img alt={tx.quote.cryptoCurrency} className="h-3 w-3" src={TOKEN_ICON_URL[tx.quote.cryptoCurrency] ?? TOKEN_ICON_URL.USDC} />
                      </div>
                      {getStatusStyle && getStatusText && (
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getStatusStyle(tx.status))}>
                          {getStatusText(tx.status)}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ab-text-muted)]" />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Empty state for transactions when authenticated but no history */}
        {isAuthenticated && !hasTransactions && (
          <div className="mt-8 text-center">
            <p className="text-sm text-[var(--ab-text-muted)]">
              {t('home.no_transactions', 'No transactions yet. Start by scanning a QR code or making a manual payment.')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
