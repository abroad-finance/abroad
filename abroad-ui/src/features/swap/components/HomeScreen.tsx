import { useTranslate } from '@tolgee/react'
import {
  ArrowDownToLine, BadgeCheck, ChevronDown, ChevronRight, Keyboard, ListChecks, Lock, QrCode, Store, Wallet,
} from 'lucide-react'
import React from 'react'

import type { OnboardingRates } from '@/features/swap/types'

import BreBLogo from '@/assets/Logos/networks/Bre-b.svg'
import { CurrencyToggle } from '@/components/ui'
import { ActivityStatusPill } from '@/features/activity/components/ActivityStatusPill'
import { activityStatusPresentation } from '@/features/activity/shared/activityPresentation'
import {
  CHAIN_MAP, COUNTRIES, CURRENCY_FLAG_URL, RECENT_COUNTRY_CONFIG, TOKEN_ICONS,
} from '@/shared/constants'
import {
  cn, localeForCurrency, numberFormatOptions,
} from '@/shared/utils'

import { type ConsumerActivityTransactionDto, _36EnumsTargetCurrency as TargetCurrency } from '../../../api'

const TOKEN_ICON_URL = TOKEN_ICONS

const PAYMENT_ACTION_CARD_CLASS = 'flex h-full min-h-[clamp(92px,14vh,118px)] w-full flex-col items-center justify-center gap-[clamp(0.25rem,1vh,0.5rem)] rounded-[clamp(1rem,3vh,1.5rem)] p-[clamp(0.5rem,1.5vw,1rem)] text-center transition-[background-color,border-color,box-shadow,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3ca383] focus-visible:ring-offset-2'
const PAYMENT_ACTION_ICON_CLASS = 'flex h-[clamp(2.25rem,6vh,3.25rem)] w-[clamp(2.25rem,6vh,3.25rem)] shrink-0 items-center justify-center rounded-[clamp(0.5rem,1.5vh,0.875rem)]'
const PAYMENT_ACTION_LABEL_CLASS = 'text-[clamp(0.75rem,1.8vw+0.4vh,1.05rem)] font-bold leading-tight'

const TRUST_BADGE_DATA = [
  { defaultLabel: 'Track every payment', i18nKey: 'home.trust_tracking' as const, Icon: ListChecks },
  { defaultLabel: 'Review before paying', i18nKey: 'home.trust_review' as const, Icon: BadgeCheck },
  { defaultLabel: 'Wallet authorized', i18nKey: 'home.trust_wallet' as const, Icon: Lock },
]

export interface HomeScreenProps {
  balance: null | string
  hasEnteredApp?: boolean
  isAuthenticated: boolean
  onboardingRates?: OnboardingRates
  onBuyCrypto?: () => void
  onEnterApp?: () => void
  onGoToManual: () => void
  onHistoryClick: () => void
  onOpenChainModal?: () => void
  onRequestConnect: () => void
  onSelectCurrency?: (currency: TargetCurrency) => void
  onSelectTransaction?: (tx: ConsumerActivityTransactionDto) => void
  onUseQr: () => void
  recentTransactions: ConsumerActivityTransactionDto[]
  selectedChainKey?: string
  selectedTokenLabel: string
  supportedNetworks?: ReadonlyArray<{ icon?: string, key: string, label: string }>
  targetCurrency: TargetCurrency
}

export default function HomeScreen({
  balance,
  hasEnteredApp = false,
  isAuthenticated,
  onboardingRates,
  onBuyCrypto,
  onEnterApp,
  onGoToManual,
  onHistoryClick,
  onOpenChainModal,
  onRequestConnect,
  onSelectCurrency,
  onSelectTransaction,
  onUseQr,
  recentTransactions,
  selectedChainKey,
  selectedTokenLabel,
  supportedNetworks = [],
  targetCurrency,
}: Readonly<HomeScreenProps>): React.JSX.Element {
  const { t } = useTranslate()
  const balanceNum = balance === null ? null : Number.parseFloat(balance.replace(/,/g, ''))

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

    const ratesUpdatedAt = onboardingRates?.updatedAt
      ? new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(onboardingRates.updatedAt))
      : null

    return (
      <main className="flex w-full flex-col items-center px-4 py-4">
        <div className="my-auto flex w-full max-w-[min(90vw,667px)] flex-col items-center justify-center">
          {/* Live badge – Figma 5:13 */}
          <div className="ab-hero-live-badge mb-[clamp(0.5rem,2vh,1rem)] flex shrink-0 items-center gap-2 rounded-full px-[clamp(0.75rem,2vw,1rem)] py-[clamp(0.25rem,1vh,0.375rem)]">
            <span className="ab-hero-live-dot h-[clamp(0.375rem,1.5vh,0.5rem)] w-[clamp(0.375rem,1.5vh,0.5rem)] shrink-0 animate-pulse rounded-full motion-reduce:animate-none" />
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
            {t('home.subline', 'Choose a local payment method, review the quote, and track the payment from your wallet to the recipient.')}
          </p>

          {/* Chain badges – Figma 5:24 */}
          <div className="mb-[clamp(0.75rem,2.5vh,1.5rem)] flex shrink-0 flex-wrap items-center justify-center gap-[clamp(0.5rem,1.5vh,0.75rem)]">
            {supportedNetworks.map(({ icon, key, label }) => {
              const chainFamily = key.toLowerCase().split(':')[0] ?? ''
              return (
                <div
                  className={cn(
                    'flex items-center gap-[clamp(0.25rem,1vw,0.5rem)] self-stretch rounded-full border border-[var(--ab-border)] bg-[var(--ab-card)] px-[clamp(0.5rem,2vw,1rem)] py-[clamp(0.25rem,1vh,0.35rem)]',
                    chainFamily === 'celo' && 'ab-hero-chain-celo',
                    chainFamily === 'solana' && 'ab-hero-chain-solana',
                    chainFamily === 'stellar' && 'ab-hero-chain-stellar',
                  )}
                  key={key}
                >
                  {icon && (
                    <img
                      alt=""
                      className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0 object-contain"
                      src={icon}
                    />
                  )}
                  <span
                    className={cn(
                      'text-center text-[clamp(0.75rem,1.5vw+0.5vh,0.875rem)] font-medium leading-tight',
                      chainFamily === 'celo' && 'ab-hero-chain-celo-text',
                      chainFamily === 'solana' && 'ab-hero-chain-solana-text',
                      chainFamily === 'stellar' && 'ab-hero-chain-stellar-text',
                    )}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Exchange Rates Section */}
          {onboardingRates && (
            <div className="mb-[clamp(0.5rem,2vh,1rem)] w-full max-w-[min(85vw,400px)]">
              <p className="ab-hero-subline text-center text-[clamp(0.75rem,1.5vw+0.5vh,0.875rem)] font-medium mb-[clamp(0.25rem,1vh,0.75rem)]">
                {t('home.exchange_rates', 'Indicative exchange rates')}
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
              <p className="mt-2 text-center text-[clamp(0.65rem,1.4vw,0.75rem)] leading-relaxed text-[var(--ab-text-muted)]">
                {ratesUpdatedAt
                  ? t('home.exchange_rates_context', 'From Abroad quotes · updated {time}. Your final rate, fees, and amount are confirmed before payment.', { time: ratesUpdatedAt })
                  : t('home.exchange_rates_unavailable', 'Indicative rates are temporarily unavailable. Your final rate, fees, and amount are confirmed before payment.')}
              </p>
            </div>
          )}

          {/* CTA Button – Figma 5:36 */}
          <button
            className="ab-hero-cta mb-[clamp(0.5rem,1.5vh,1rem)] flex min-h-11 shrink-0 items-center justify-center gap-[clamp(0.25rem,1vw,0.5rem)] rounded-[clamp(0.75rem,2vh,1rem)] px-[clamp(1.5rem,4vw,2rem)] py-[clamp(0.5rem,1.5vh,1rem)] font-bold text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
            onClick={onEnterApp}
            type="button"
          >
            <span className="text-[clamp(1rem,2.5vw+1vh,1.125rem)] leading-tight">
              {t('home.cta_continue', 'Continue')}
            </span>
            <ChevronRight className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0" />
          </button>

          {/* Trust badges – Figma 5:41 */}
          <div className="ab-hero-subline flex w-full flex-wrap items-center justify-center gap-x-[clamp(0.5rem,2vw,2rem)] gap-y-2">
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
  const selectedRate = selectedTokenLabel === 'USDT'
    ? targetCurrency === TargetCurrency.BRL ? onboardingRates?.brl.USDT : onboardingRates?.cop.USDT
    : targetCurrency === TargetCurrency.BRL ? onboardingRates?.brl.USDC : onboardingRates?.cop.USDC
  const localBalance = balanceNum !== null && Number.isFinite(balanceNum) && selectedRate !== null && selectedRate !== undefined
    ? c.decimals === 0
      ? Math.round(balanceNum * selectedRate).toLocaleString('es-CO')
      : (balanceNum * selectedRate).toFixed(c.decimals)
    : '--'

  const chainKey = selectedChainKey?.toLowerCase().split(':')[0] ?? 'stellar'
  const chainInfo = CHAIN_MAP[chainKey] ?? CHAIN_MAP.stellar

  // Helper to check if we should show transactions section.
  // Only the user's own (scoped) transactions are shown — never partner-wide data.
  const hasTransactions = isAuthenticated && recentTransactions.length > 0
  const isPixRail = targetCurrency === TargetCurrency.BRL
  const paymentKeyLabel = isPixRail
    ? t('home.pay_with_pix_key', 'Pay with PIX key')
    : t('home.pay_with_breb_key', 'Pay with Llave BRE-B')
  const buyCryptoLabel = t('home.buy_crypto', 'Buy crypto with PIX')
  const useQrHint = t('home.use_qr_hint', 'Camera, paste, or screenshot')
  const useQrLabel = isPixRail
    ? t('home.use_pix_qr', 'Use a Pix QR code')
    : t('home.use_breb_qr', 'Use a BRE-B QR code')

  return (
    <div className="flex w-full flex-col items-center px-0">
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
              {isAuthenticated ? balance ?? '--' : '--'}
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
                'flex min-h-11 items-center gap-2 rounded-full border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-[13px] py-[7px] transition-colors hover:opacity-90',
                !isAuthenticated && 'opacity-80',
              )}
              onClick={onOpenChainModal}
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

        {/* One QR journey exposes camera, paste, and upload contextually; manual recipient keys stay separate. */}
        <div className="mt-[clamp(0.75rem,2.5vh,1.5rem)] grid grid-cols-2 items-stretch gap-[clamp(0.375rem,1.25vw,0.75rem)]">
          <button
            aria-label={useQrLabel}
            className={cn(
              PAYMENT_ACTION_CARD_CLASS,
              'px-[clamp(0.75rem,2vw,1.25rem)] sm:flex-row sm:justify-start sm:text-left',
              isAuthenticated
                ? 'bg-[#3ca383] shadow-[0px_0px_15px_0px_rgba(16,185,129,0.3)] hover:opacity-95'
                : 'bg-[#3ca383]/80 hover:bg-[#3ca383]',
            )}
            onClick={onUseQr}
            type="button"
          >
            <div className={cn(PAYMENT_ACTION_ICON_CLASS, 'bg-white/20 backdrop-blur-[2px]')}>
              <QrCode className="h-full w-full p-[clamp(0.375rem,1.5vh,0.5rem)] text-white" strokeWidth={1.5} />
            </div>
            <span className="flex min-w-0 flex-1 flex-col items-center gap-1 sm:items-start">
              <span className={cn(PAYMENT_ACTION_LABEL_CLASS, 'text-white')}>
                {useQrLabel}
              </span>
              <span className="text-[clamp(0.7rem,1.4vw,0.8rem)] font-medium leading-tight text-white/80">
                {useQrHint}
              </span>
            </span>
            <img
              alt=""
              className={cn(
                'hidden h-[clamp(1rem,2.5vh,1.25rem)] w-auto shrink-0 sm:block',
                !isPixRail && 'rounded bg-white px-1 py-0.5',
              )}
              src={isPixRail ? '/pix-white.svg' : BreBLogo}
            />
          </button>

          <button
            aria-label={paymentKeyLabel}
            className={cn(
              PAYMENT_ACTION_CARD_CLASS,
              isAuthenticated
                ? 'bg-[var(--ab-bg-card)] shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_-1px_rgba(0,0,0,0.02)] hover:shadow-md'
                : 'bg-[var(--ab-bg-subtle)] border border-[var(--ab-border)]',
            )}
            onClick={onGoToManual}
            type="button"
          >
            <div className={cn(PAYMENT_ACTION_ICON_CLASS, 'bg-[var(--ab-bg-subtle)]')}>
              <Keyboard
                className="h-full w-full p-[clamp(0.375rem,1.5vh,0.5rem)] text-[var(--ab-text-secondary)]"
                strokeWidth={1.5}
              />
            </div>
            <span className={cn(PAYMENT_ACTION_LABEL_CLASS, 'text-[var(--ab-text)]')}>
              {paymentKeyLabel}
            </span>
          </button>

          {onBuyCrypto && isPixRail && (
            <button
              aria-label={buyCryptoLabel}
              className={cn(
                PAYMENT_ACTION_CARD_CLASS,
                isAuthenticated
                  ? 'bg-[var(--ab-bg-card)] shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_-1px_rgba(0,0,0,0.02)] hover:shadow-md'
                  : 'bg-[var(--ab-bg-subtle)] border border-[var(--ab-border)]',
              )}
              onClick={onBuyCrypto}
              type="button"
            >
              <div className={cn(PAYMENT_ACTION_ICON_CLASS, 'bg-[var(--ab-bg-subtle)]')}>
                <ArrowDownToLine
                  className="h-full w-full p-[clamp(0.375rem,1.5vh,0.5rem)] text-[var(--ab-text-secondary)]"
                  strokeWidth={1.5}
                />
              </div>
              <span className={cn(PAYMENT_ACTION_LABEL_CLASS, 'text-[var(--ab-text)]')}>
                {buyCryptoLabel}
              </span>
            </button>
          )}
        </div>

        {/* Connect wallet hint - shown when not authenticated */}
        {!isAuthenticated && (
          <div className="mt-[clamp(0.75rem,2.5vh,1.5rem)] flex justify-center">
            <button
              className="ab-hero-cta flex min-h-11 items-center gap-[clamp(0.25rem,1vw,0.5rem)] rounded-[clamp(0.75rem,2vh,1rem)] px-[clamp(1rem,3vw,1.5rem)] py-[clamp(0.5rem,1.5vh,0.75rem)] font-bold text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
              onClick={onRequestConnect}
              type="button"
            >
              <Wallet className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)]" />
              <span className="text-[clamp(0.875rem,2vw+0.5vh,1rem)] leading-tight">
                {t('home.cta_connect', 'Connect wallet to continue')}
              </span>
              <ChevronRight className="h-[clamp(1rem,2.5vh,1.25rem)] w-[clamp(1rem,2.5vh,1.25rem)] shrink-0" />
            </button>
          </div>
        )}

        {/* Recent transactions - only when authenticated */}
        {hasTransactions && (
          <div className="mt-[clamp(0.5rem,2vh,1rem)]">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase leading-4 tracking-[1.2px] text-[var(--ab-text-muted)]">
                {t('home.recent', 'Recent')}
              </span>
              <button
                className="min-h-11 rounded-xl px-2 text-sm font-medium leading-5 text-[var(--ab-green)] hover:bg-[var(--ab-green-soft)]"
                onClick={onHistoryClick}
                type="button"
              >
                {t('home.see_all', 'See all')}
              </button>
            </div>
            <div className="divide-y divide-[var(--ab-border)] overflow-hidden rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-card)]">
              {recentTransactions.slice(0, 2).map((tx) => {
                const countryConfig = RECENT_COUNTRY_CONFIG[tx.quote.targetCurrency] ?? RECENT_COUNTRY_CONFIG.COP
                const statusPresentation = activityStatusPresentation(tx.status, (key, fallback) => t(key, fallback))
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
                      <div className="text-sm font-semibold text-[var(--ab-text)]">
                        {tx.recipientHint ?? t('activity.recipient.unavailable', 'Recipient unavailable')}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ab-text-muted)]">
                        {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(tx.timestamps.createdAt))}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <div className="flex items-center gap-1 text-sm font-semibold text-[var(--ab-text)]">
                        {countryConfig.symbol}
                        {localAmount}
                        <img alt={countryConfig.currency} className="h-3 w-3 rounded-full" src={countryConfig.flagUrl} />
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-[var(--ab-text-muted)]">
                        $
                        {tx.quote.sourceAmount.toFixed(2)}
                        <img alt={tx.quote.sourceCurrency} className="h-3 w-3" src={TOKEN_ICON_URL[tx.quote.sourceCurrency] ?? TOKEN_ICON_URL.USDC} />
                      </div>
                      <ActivityStatusPill label={statusPresentation.label} tone={statusPresentation.tone} />
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
              {t('home.no_transactions', 'No transactions yet. Choose a payment method above to get started.')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
