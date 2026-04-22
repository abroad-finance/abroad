import { useTranslate } from '@tolgee/react'
import {
  ChevronDown, ChevronRight, Keyboard, Lock, PiggyBank, QrCode, Store, Zap,
} from 'lucide-react'
import React from 'react'

import { CurrencyToggle } from '@/components/ui'
import { ASSET_URLS } from '@/shared/constants'
import { cn } from '@/shared/utils'

import { _36EnumsTargetCurrency as TargetCurrency, type TransactionListItem } from '../../../api'
import BreBLogo from '../../../assets/Logos/networks/Bre-b.svg'

const RECENT_COUNTRY_CONFIG: Record<string, { currency: string, flagUrl: string, symbol: string }> = {
  BRL: { currency: 'BRL', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg', symbol: 'R$' },
  COP: { currency: 'COP', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg', symbol: '$' },
}

const CHAIN_CONFIG = [
  { icon: ASSET_URLS.STELLAR_CHAIN_ICON, key: 'stellar', label: 'Stellar' },
  { icon: ASSET_URLS.CELO_CHAIN_ICON, key: 'celo', label: 'Celo' },
  { icon: ASSET_URLS.SOLANA_CHAIN_ICON, key: 'solana', label: 'Solana' },
] as const

const CURRENCY_FLAG_URL: Record<string, string> = {
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
}

const COUNTRIES: Record<string, { decimals: number, rate: number }> = {
  BRL: { decimals: 2, rate: 5.82 },
  COP: { decimals: 0, rate: 4198.5 },
}

const RAIL_LOGO: Record<string, string> = {
  BRL: '/pix-white.svg',
  COP: BreBLogo,
}

const TOKEN_ICON_URL: Record<string, string> = {
  USDC: ASSET_URLS.USDC_TOKEN_ICON,
  USDT: ASSET_URLS.USDT_TOKEN_ICON,
}

const CHAIN_MAP: Record<string, { bg: string, color: string, icon: string, name: string }> = {
  celo: {
    bg: 'var(--ab-chain-celo-bg)', color: 'var(--ab-chain-celo)', icon: ASSET_URLS.CELO_CHAIN_ICON, name: 'Celo',
  },
  solana: {
    bg: 'var(--ab-chain-solana-bg)', color: 'var(--ab-chain-solana)', icon: ASSET_URLS.SOLANA_CHAIN_ICON, name: 'Solana',
  },
  stellar: {
    bg: 'var(--ab-chain-stellar-bg)', color: 'var(--ab-chain-stellar)', icon: ASSET_URLS.STELLAR_CHAIN_ICON, name: 'Stellar',
  },
}

export interface HomeScreenProps {
  balance: string
  formatDate?: (dateString: string) => string
  getStatusStyle?: (status: string) => string
  getStatusText?: (status: string) => string
  /** True when onboarding was bypassed (click "Continuar" or already has wallet) */
  hasPassedOnboarding?: boolean
  isAuthenticated: boolean
  onConnectWallet: () => void
  onGoToManual: () => void
  onHistoryClick: () => void
  onOpenChainModal?: () => void
  onOpenQr: () => void
  onPassOnboarding?: () => void
  onSelectCurrency?: (currency: TargetCurrency) => void
  onSelectTransaction?: (tx: TransactionListItem) => void
  recentTransactions: TransactionListItem[]
  /** Fallback when recentTransactions is empty (from useUserTransactions) */
  recentTransactionsFallback?: RecentTxSummary[]
  selectedChainKey?: string
  selectedTokenLabel: string
  targetCurrency: TargetCurrency
}

export type RecentTxSummary = {
  country: string
  localAmount: string
  merchant: string
  time: string
  usdcAmount: string
}

export default function HomeScreen({
  balance,
  formatDate,
  getStatusStyle,
  getStatusText,
  isAuthenticated,
  onConnectWallet,
  onGoToManual,
  onHistoryClick,
  onOpenChainModal,
  onOpenQr,
  onPassOnboarding,
  onSelectCurrency,
  onSelectTransaction,
  recentTransactions,
  recentTransactionsFallback = [],
  selectedChainKey,
  selectedTokenLabel,
  targetCurrency,
}: Readonly<HomeScreenProps>): React.JSX.Element {
  const { t } = useTranslate()
  const balanceNum = Number.parseFloat(balance.replace(/,/g, '')) || 0

  // Unauthenticated view – Figma node 5:2 pixel-perfect
  if (!isAuthenticated) {
    const trustBadges = [
      { Icon: Zap, label: t('home.trust_settlement', '< 3s settlement') },
      { Icon: PiggyBank, label: t('home.trust_fees', 'Low fees') },
      { Icon: Lock, label: t('home.trust_custodial', 'Non-custodial') },
    ] as const

    return (
      <main className="flex w-full min-h-full flex-1 flex-col items-center justify-center px-4 pt-[10px] pb-8 md:px-8 md:py-[151px] overflow-hidden">
        <div className="flex w-full max-w-[667px] flex-col items-center">
          {/* Live badge – Figma 5:13 */}
          <div
            className="ab-hero-live-badge mb-8 flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5"
          >
            <span
              className="ab-hero-live-dot h-2 w-2 shrink-0 rounded-full animate-pulse"
            />
            <span
              className="ab-hero-live-text text-sm font-medium leading-5"
            >
              {t('home.live_badge', 'Live in Colombia & Brazil')}
            </span>
          </div>

          {/* Headline – Figma 5:20 */}
          <h1 className="mb-6 text-center text-[40px] font-extrabold leading-[48px] tracking-[-1.5px] md:text-[60px] md:leading-[60px]">
            <span className="ab-hero-heading-dark">
              {t('home.headline_1', 'Spend your')}
              <br />
              {t('home.headline_1b', 'stablecoins at')}
            </span>
            <br />
            <span className="ab-hero-heading-accent">
              {t('home.headline_2', 'local merchants.')}
            </span>
          </h1>

          {/* Subline – Figma 5:22 */}
          <p
            className="ab-hero-subline mb-8 max-w-[461px] text-center text-xl font-normal leading-7"
          >
            {t('home.subline', 'Connect your wallet, scan a QR code, and pay — the merchant receives local currency instantly.')}
          </p>

          {/* Chain badges – Figma 5:24 */}
          <div className="mb-10 flex shrink-0 flex-wrap items-center justify-center gap-3">
            {CHAIN_CONFIG.map(({ icon, key, label }) => {
              const bgClass = key === 'celo' ? 'ab-hero-chain-celo' : key === 'solana' ? 'ab-hero-chain-solana' : 'ab-hero-chain-stellar'
              const textClass = key === 'celo' ? 'ab-hero-chain-celo-text' : key === 'solana' ? 'ab-hero-chain-solana-text' : 'ab-hero-chain-stellar-text'
              return (
                <div
                  className={`${bgClass} flex items-center gap-2 self-stretch rounded-full px-4 py-[5.5px]`}
                  key={key}
                >
                  <img
                    alt={label}
                    className="h-5 w-5 shrink-0 object-contain"
                    src={icon}
                  />
                  <span
                    className={`${textClass} text-center text-sm font-medium leading-5`}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* CTA Button – Figma 5:36 (onboarding "Continuar" → passes through, wallet connect otherwise) */}
          <button
            className="ab-hero-cta mb-6 flex shrink-0 items-center justify-center gap-2 rounded-2xl px-8 py-4 font-bold text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90 md:mb-12"
            onClick={onPassOnboarding ?? onConnectWallet}
            type="button"
          >
            <span className="text-lg leading-7">
              {t('home.cta_continue', 'Continuar')}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>

          {/* Trust badges – Figma 5:41 */}
          <div
            className="ab-hero-subline flex w-full flex-nowrap items-center justify-between gap-2 sm:flex-wrap sm:justify-center sm:gap-8"
          >
            {trustBadges.map(({ Icon, label }) => (
              <div
                className="flex shrink-0 items-center gap-1.5 sm:gap-2"
                key={label}
              >
                <Icon className="h-3 w-3 shrink-0 sm:h-[13px] sm:w-[13px]" strokeWidth={2} />
                <span className="whitespace-nowrap text-center text-xs font-medium leading-5 sm:text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  // Authenticated view – Figma 1:3 / 1:42 pixel-perfect
  const c = targetCurrency === TargetCurrency.BRL ? COUNTRIES.BRL : COUNTRIES.COP
  const localBalance = c.decimals === 0
    ? Math.round(balanceNum * c.rate).toLocaleString('es-CO')
    : (balanceNum * c.rate).toFixed(c.decimals)

  const chainKey = selectedChainKey?.toLowerCase().split(':')[0] ?? 'stellar'
  const chainInfo = CHAIN_MAP[chainKey] ?? CHAIN_MAP.stellar

  return (
    <div className="flex w-full flex-1 flex-col items-center px-0">
      <div className="w-full max-w-[576px]">
        {/* Balance – Figma 1:46 */}
        <div className="flex flex-col items-center gap-1 py-1">
          <p className="text-center text-xs font-bold uppercase leading-4 tracking-[1.2px] text-ab-text-2">
            {t('home.your_balance', 'Your Balance')}
          </p>
          <div className="flex items-center justify-center gap-3">
            {TOKEN_ICON_URL[selectedTokenLabel]
              ? (
                  <img
                    alt={selectedTokenLabel}
                    className="h-8 w-8 shrink-0 self-center object-contain md:h-9 md:w-9"
                    src={TOKEN_ICON_URL[selectedTokenLabel]}
                  />
                )
              : (
                  <span className="text-2xl font-medium text-ab-green md:text-[30px] md:leading-9">
                    {selectedTokenLabel}
                  </span>
                )}
            <span className="text-center text-[40px] font-black leading-[48px] text-ab-text md:text-[60px] md:leading-[60px]">
              $
              {balance}
            </span>
          </div>
          <div className="flex h-8 items-center justify-center pt-1">
            <div className="flex items-center gap-2 rounded-full border border-ab-border bg-ab-card/60 px-[13px] py-[4.5px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
              {CURRENCY_FLAG_URL[targetCurrency] && (
                <img
                  alt={targetCurrency}
                  className="h-5 w-5 shrink-0 object-contain"
                  src={CURRENCY_FLAG_URL[targetCurrency]}
                />
              )}
              <span className="text-xs font-medium leading-4 text-ab-text-2">
                ≈
                {targetCurrency === TargetCurrency.BRL ? ' R$' : ' $'}
                {localBalance}
                {' '}
                {targetCurrency}
              </span>
            </div>
          </div>
        </div>

        {/* Chain + currency toggle – Figma 9:332 / 9:368 */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onOpenChainModal && (
            <button
              className="flex items-center gap-2 rounded-full border border-ab-border bg-ab-hover px-[13px] py-[7px] transition-colors hover:opacity-90"
              onClick={onOpenChainModal}
              type="button"
            >
              <img alt={chainInfo.name} className="h-5 w-5" src={chainInfo.icon} />
              <span className="text-xs font-semibold text-ab-text">
                {selectedTokenLabel}
                {' '}
                on
                {' '}
                {chainInfo.name}
              </span>
              <ChevronDown className="h-4 w-4 text-ab-text" />
            </button>
          )}
          {onSelectCurrency && (
            <CurrencyToggle
              onChange={c => onSelectCurrency(c)}
              value={targetCurrency}
            />
          )}
        </div>

        {/* Payment cards – Figma 1:71, 2 cols equal height, responsive */}
        <div className="mt-6 grid grid-cols-2 gap-3 items-stretch md:mt-10 md:gap-4">
          <button
            className="flex h-full min-h-[140px] w-full flex-col items-center justify-center gap-1.5 rounded-[24px] bg-ab-green p-4 text-center shadow-[0px_0px_15px_0px_rgba(16,185,129,0.3)] transition-opacity hover:opacity-95 md:min-h-[180px] md:gap-4 md:rounded-[32px] md:p-6"
            onClick={onOpenQr}
            type="button"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] bg-white/20 backdrop-blur-[2px] md:h-24 md:w-24 md:rounded-[20px]">
              <QrCode className="h-full w-full p-2 text-white" strokeWidth={1.5} />
            </div>
            <span className="text-sm font-bold leading-tight text-white md:text-xl md:leading-[25px]">
              {t('home.scan_to_pay', 'Scan to Pay')}
            </span>
            <img
              alt={targetCurrency === TargetCurrency.BRL ? 'PIX' : 'Bre-B'}
              className="h-4 w-auto shrink-0 md:h-6"
              src={RAIL_LOGO[targetCurrency]}
            />
          </button>

          <button
            className="flex h-full min-h-[140px] w-full flex-col items-center justify-center gap-1.5 rounded-[24px] bg-ab-card p-4 text-center shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_-1px_rgba(0,0,0,0.02)] transition-shadow hover:shadow-md md:min-h-[180px] md:gap-4 md:rounded-[32px] md:p-6"
            onClick={onGoToManual}
            type="button"
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[14px] bg-ab-hover md:h-24 md:w-24 md:rounded-[20px]">
              <Keyboard className="h-full w-full p-2 text-ab-text" strokeWidth={1.5} />
            </div>
            <span className="text-sm font-bold leading-tight text-ab-text md:text-xl md:leading-[25px]">
              {t('home.manual_payment', 'Manual Payment')}
            </span>
          </button>
        </div>

        {/* Recent – walletDetails when available, fallback to useUserTransactions */}
        {(recentTransactions.length > 0 || recentTransactionsFallback.length > 0) && (
          <div className="mt-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase leading-4 tracking-[1.2px] text-ab-text-2">
                {t('home.recent', 'Recent')}
              </span>
              <button
                className="text-sm font-medium leading-5 text-ab-green"
                onClick={onHistoryClick}
                type="button"
              >
                {t('home.see_all', 'See all')}
              </button>
            </div>
            <div className="divide-y divide-ab-border overflow-hidden rounded-2xl border border-ab-border bg-ab-card">
              {recentTransactions.length > 0
                ? recentTransactions.slice(0, 2).map((tx) => {
                    const countryConfig = RECENT_COUNTRY_CONFIG[tx.quote.targetCurrency] ?? RECENT_COUNTRY_CONFIG.COP
                    const isExpired = tx.status === 'PAYMENT_EXPIRED' || tx.status === 'PAYMENT_FAILED' || tx.status === 'WRONG_AMOUNT'
                    const localAmount = tx.quote.targetAmount.toLocaleString(
                      tx.quote.targetCurrency === 'BRL' ? 'pt-BR' : 'es-CO',
                      tx.quote.targetCurrency === 'COP'
                        ? { maximumFractionDigits: 0, minimumFractionDigits: 0 }
                        : { maximumFractionDigits: 2, minimumFractionDigits: 2 },
                    )
                    return (
                      <button
                        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-ab-hover"
                        key={tx.id}
                        onClick={() => (onSelectTransaction ? onSelectTransaction(tx) : onHistoryClick())}
                        type="button"
                      >
                        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-ab-border bg-ab-hover">
                          <Store className="h-3.5 w-3.5 text-ab-text-2" strokeWidth={1.5} />
                          <img
                            alt={countryConfig.currency}
                            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-ab-card object-cover shadow-sm"
                            src={countryConfig.flagUrl}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              'text-sm font-semibold',
                              isExpired ? 'text-ab-text-2 line-through' : 'text-ab-text',
                            )}
                          >
                            {tx.accountNumber}
                          </div>
                          {formatDate && (
                            <div className="mt-0.5 text-xs text-ab-text-2">
                              {formatDate(tx.createdAt)}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <div
                            className={cn(
                              'text-sm font-semibold',
                              isExpired ? 'text-ab-text-2 line-through' : 'text-ab-text',
                            )}
                          >
                            {countryConfig.symbol}
                            {localAmount}
                            {' '}
                            {countryConfig.currency}
                          </div>
                          <div className="text-[11px] text-ab-text-2">
                            $
                            {tx.quote.sourceAmount.toFixed(2)}
                            {' '}
                            {selectedTokenLabel}
                          </div>
                          {getStatusStyle && getStatusText && (
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getStatusStyle(tx.status))}>
                              {getStatusText(tx.status)}
                            </span>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ab-text-3" />
                      </button>
                    )
                  })
                : recentTransactionsFallback.slice(0, 2).map((tx, i) => {
                    const countryConfig = RECENT_COUNTRY_CONFIG[tx.country] ?? RECENT_COUNTRY_CONFIG.COP
                    return (
                      <button
                        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-ab-hover"
                        key={`${tx.merchant}-${tx.time}-${i}`}
                        onClick={onHistoryClick}
                        type="button"
                      >
                        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-ab-border bg-ab-hover">
                          <Store className="h-3.5 w-3.5 text-ab-text-2" strokeWidth={1.5} />
                          <img
                            alt={countryConfig.currency}
                            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-ab-card object-cover shadow-sm"
                            src={countryConfig.flagUrl}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-ab-text">{tx.merchant}</div>
                          <div className="mt-0.5 text-xs text-ab-text-2">
                            {tx.country === 'COP' ? t('country.colombia', 'Colombia') : t('country.brazil', 'Brazil')}
                            {' · '}
                            {tx.time}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-ab-text">
                            {countryConfig.symbol}
                            {tx.localAmount}
                            {' '}
                            {countryConfig.currency}
                          </div>
                          <div className="text-[11px] text-ab-text-2">
                            $
                            {tx.usdcAmount}
                            {' '}
                            {selectedTokenLabel}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ab-text-3" />
                      </button>
                    )
                  })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
