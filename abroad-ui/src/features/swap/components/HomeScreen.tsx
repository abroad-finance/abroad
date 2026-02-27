import { useTranslate } from '@tolgee/react'
import { ChevronDown, ChevronRight, Keyboard, Lock, PiggyBank, QrCode, Zap } from 'lucide-react'
import React from 'react'

import { _36EnumsTargetCurrency as TargetCurrency, type TransactionListItem } from '../../../api'
import { CurrencyToggle } from '../../../components/ui'

const RECENT_COUNTRY_CONFIG: Record<string, { flag: string, symbol: string, currency: string }> = {
  COP: { flag: '🇨🇴', symbol: '$', currency: 'COP' },
  BRL: { flag: '🇧🇷', symbol: 'R$', currency: 'BRL' },
}
import { ASSET_URLS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

/* Figma node 5:2 – pixel-perfect spec from ABROAD NEW UI */
const HERO_LIVE_BADGE = { bg: '#e8f5f1', dot: '#1ec677', text: '#0f513a' }
const HERO_HEADING = { dark: '#101828', accent: '#73b9a3' }
const HERO_SUBLINE = '#6b7280'
const HERO_CHAINS = {
  stellar: { bg: '#f3f4f6', text: '#000000' },
  celo: { bg: 'rgba(255,241,162,0.94)', text: '#000000' },
  solana: { bg: '#f3ebfd', text: '#6b21a8' },
}
const HERO_CTA_BG = '#54ae92'

const CHAIN_CONFIG = [
  { key: 'stellar', label: 'Stellar', icon: ASSET_URLS.STELLAR_CHAIN_ICON },
  { key: 'celo', label: 'Celo', icon: ASSET_URLS.CELO_CHAIN_ICON },
  { key: 'solana', label: 'Solana', icon: ASSET_URLS.SOLANA_CHAIN_ICON },
] as const

const COUNTRIES: Record<string, { flag: string, rate: number, decimals: number }> = {
  BRL: { flag: '🇧🇷', rate: 5.82, decimals: 2 },
  COP: { flag: '🇨🇴', rate: 4198.5, decimals: 0 },
}

const CHAIN_MAP: Record<string, { icon: string, bg: string, color: string, name: string }> = {
  stellar: { icon: ASSET_URLS.STELLAR_CHAIN_ICON, bg: 'var(--ab-chain-stellar-bg)', color: 'var(--ab-chain-stellar)', name: 'Stellar' },
  celo: { icon: ASSET_URLS.CELO_CHAIN_ICON, bg: 'var(--ab-chain-celo-bg)', color: 'var(--ab-chain-celo)', name: 'Celo' },
  solana: { icon: ASSET_URLS.SOLANA_CHAIN_ICON, bg: 'var(--ab-chain-solana-bg)', color: 'var(--ab-chain-solana)', name: 'Solana' },
}

export type RecentTxSummary = {
  country: string
  localAmount: string
  merchant: string
  time: string
  usdcAmount: string
}

export interface HomeScreenProps {
  balance: string
  formatDate?: (dateString: string) => string
  getStatusStyle?: (status: string) => string
  getStatusText?: (status: string) => string
  isAuthenticated: boolean
  onConnectWallet: () => void
  onHistoryClick: () => void
  onOpenChainModal?: () => void
  onOpenQr: () => void
  onSelectCurrency?: (currency: TargetCurrency) => void
  onSelectTransaction?: (tx: TransactionListItem) => void
  onGoToManual: () => void
  recentTransactions: TransactionListItem[]
  /** Fallback when recentTransactions is empty (from useUserTransactions) */
  recentTransactionsFallback?: RecentTxSummary[]
  selectedChainKey?: string
  selectedTokenLabel: string
  targetCurrency: TargetCurrency
}

export default function HomeScreen({
  balance,
  formatDate,
  getStatusStyle,
  getStatusText,
  isAuthenticated,
  onConnectWallet,
  onHistoryClick,
  onOpenChainModal,
  onOpenQr,
  onGoToManual,
  onSelectCurrency,
  onSelectTransaction,
  recentTransactions,
  recentTransactionsFallback = [],
  selectedChainKey,
  selectedTokenLabel,
  targetCurrency,
}: HomeScreenProps): React.JSX.Element {
  const { t } = useTranslate()
  const balanceNum = parseFloat(balance.replace(/,/g, '')) || 0

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
            className="mb-8 flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 dark:bg-emerald-900/30 dark:border dark:border-emerald-800/50"
            style={{ backgroundColor: HERO_LIVE_BADGE.bg }}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full animate-pulse"
              style={{ backgroundColor: HERO_LIVE_BADGE.dot }}
            />
            <span
              className="text-sm font-medium leading-5"
              style={{ color: HERO_LIVE_BADGE.text }}
            >
              {t('home.live_badge', 'Live in Colombia & Brazil')}
            </span>
          </div>

          {/* Headline – Figma 5:20 */}
          <h1 className="mb-6 text-center text-[40px] font-extrabold leading-[48px] tracking-[-1.5px] md:text-[60px] md:leading-[60px]">
            <span style={{ color: HERO_HEADING.dark }}>
              {t('home.headline_1', 'Spend your')}
              <br />
              stablecoins at
            </span>
            <br />
            <span style={{ color: HERO_HEADING.accent }}>
              {t('home.headline_2', 'local merchants.')}
            </span>
          </h1>

          {/* Subline – Figma 5:22 */}
          <p
            className="mb-8 max-w-[461px] text-center text-xl font-normal leading-7"
            style={{ color: HERO_SUBLINE }}
          >
            {t('home.subline', 'Connect your wallet, scan a QR code, and pay — the merchant receives local currency instantly.')}
          </p>

          {/* Chain badges – Figma 5:24 */}
          <div className="mb-10 flex shrink-0 flex-wrap items-center justify-center gap-3">
            {CHAIN_CONFIG.map(({ icon, key, label }) => {
              const theme = HERO_CHAINS[key]
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 self-stretch rounded-full px-4 py-[5.5px]"
                  style={{ backgroundColor: theme.bg }}
                >
                  <img
                    alt={label}
                    className="h-5 w-5 shrink-0 object-contain"
                    src={icon}
                  />
                  <span
                    className="text-center text-sm font-medium leading-5"
                    style={{ color: theme.text }}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* CTA Button – Figma 5:36 */}
          <button
            className="mb-6 flex shrink-0 items-center justify-center gap-2 rounded-2xl px-8 py-4 font-bold text-white shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90 md:mb-12"
            onClick={onConnectWallet}
            style={{ backgroundColor: HERO_CTA_BG }}
            type="button"
          >
            <span className="text-lg leading-7">
              {t('home.cta_connect', 'Connect Wallet to Start')}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>

          {/* Trust badges – Figma 5:41 */}
          <div
            className="flex w-full flex-nowrap items-center justify-between gap-2 sm:flex-wrap sm:justify-center sm:gap-8"
            style={{ color: HERO_SUBLINE }}
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
    <div className="flex flex-1 flex-col items-center px-4 py-6 md:px-6 md:py-[71.5px]">
      <div className="w-full max-w-[576px]">
        {/* Balance – Figma 1:46 */}
        <div className="flex flex-col items-center gap-2 py-2">
          <p className="text-center text-xs font-bold uppercase leading-4 tracking-[1.2px] text-[#6b7280]">
            {t('home.your_balance', 'Your Balance')}
          </p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-center text-[40px] font-bold leading-[48px] text-[#111827] md:text-[60px] md:leading-[60px]">
              $
              {balance}
            </span>
            <span className="pt-3 text-[24px] font-medium leading-9 text-[#10b981] md:text-[30px] md:leading-9">
              {selectedTokenLabel}
            </span>
          </div>
          <div className="flex h-[34px] items-center justify-center pt-2">
            <div className="flex items-center gap-2 rounded-full border border-[#f3f4f6] bg-[rgba(255,255,255,0.6)] px-[13px] py-[4.5px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
              <span className="text-base">{c.flag}</span>
              <span className="text-xs font-medium leading-4 text-[#6b7280]">
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
              className="flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-[13px] py-[7px] transition-colors hover:opacity-90"
              onClick={onOpenChainModal}
              type="button"
            >
              <img alt={chainInfo.name} className="h-5 w-5" src={chainInfo.icon} />
              <span className="text-xs font-semibold text-[#374151]">
                {selectedTokenLabel}
                {' '}
                on
                {' '}
                {chainInfo.name}
              </span>
              <ChevronDown className="h-4 w-4 text-[#374151]" />
            </button>
          )}
          {onSelectCurrency && (
            <CurrencyToggle
              value={targetCurrency}
              onChange={(c) => onSelectCurrency(c)}
            />
          )}
        </div>

        {/* Payment cards – Figma 1:71, 2 cols on mobile, square buttons */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:mt-10">
          <button
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[24px] bg-[#3ca383] p-4 text-center shadow-[0px_0px_15px_0px_rgba(16,185,129,0.3)] transition-opacity hover:opacity-95 md:rounded-[32px] md:gap-4 md:p-6"
            onClick={onOpenQr}
            type="button"
          >
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[18px] bg-white/20 backdrop-blur-[2px] md:h-32 md:w-32 md:rounded-[24px]">
              <QrCode className="h-full w-full p-2 text-white" strokeWidth={1.5} />
            </div>
            <span className="text-base font-bold leading-tight text-white md:text-xl md:leading-[25px]">
              {t('home.scan_to_pay', 'Scan to Pay')}
            </span>
            <span className="text-xs font-medium leading-4 text-[#d1fae5] md:text-sm md:leading-5">
              (PIX / Bre-B)
            </span>
          </button>

          <button
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-[24px] bg-white p-4 text-center shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_-1px_rgba(0,0,0,0.02)] transition-shadow hover:shadow-md md:rounded-[32px] md:gap-4 md:p-6"
            onClick={onGoToManual}
            type="button"
          >
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[18px] bg-[#f3f4f6] md:h-32 md:w-32 md:rounded-[24px]">
              <Keyboard className="h-full w-full p-2 text-[#374151]" strokeWidth={1.5} />
            </div>
            <span className="text-base font-bold leading-tight text-[#111827] md:text-xl md:leading-[25px]">
              {t('home.manual_payment', 'Manual Payment')}
            </span>
          </button>
        </div>

        {/* Recent – walletDetails when available, fallback to useUserTransactions */}
        {(recentTransactions.length > 0 || recentTransactionsFallback.length > 0) && (
          <div className="mt-6 pt-6 md:mt-10 md:pt-8">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase leading-4 tracking-[1.2px] text-[#6b7280]">
                {t('home.recent', 'Recent')}
              </span>
              <button
                className="text-sm font-medium leading-5 text-[#10b981]"
                onClick={onHistoryClick}
                type="button"
              >
                {t('home.see_all', 'See all')}
              </button>
            </div>
            <div className="divide-y divide-[#e5e7eb] overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
              {recentTransactions.length > 0
                ? recentTransactions.slice(0, 2).map((tx) => {
                  const countryConfig = RECENT_COUNTRY_CONFIG[tx.quote.targetCurrency] ?? RECENT_COUNTRY_CONFIG.COP
                  const isExpired = tx.status === 'PAYMENT_EXPIRED' || tx.status === 'PAYMENT_FAILED' || tx.status === 'WRONG_AMOUNT'
                  const localAmount = tx.quote.targetAmount.toLocaleString(
                    tx.quote.targetCurrency === 'BRL' ? 'pt-BR' : 'es-CO',
                    { maximumFractionDigits: 2, minimumFractionDigits: 2 },
                  )
                  return (
                    <button
                      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f9fafb]"
                      key={tx.id}
                      onClick={() => (onSelectTransaction ? onSelectTransaction(tx) : onHistoryClick())}
                      type="button"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] border border-[#e5e7eb] bg-[#f9fafb] text-xl">
                        {countryConfig.flag}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'text-sm font-semibold',
                            isExpired ? 'text-[#6b7280] line-through' : 'text-[#111827]',
                          )}
                        >
                          {tx.accountNumber}
                        </div>
                        {formatDate && getStatusStyle && getStatusText && (
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6b7280]">
                            <span>{formatDate(tx.createdAt)}</span>
                            <span>·</span>
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', getStatusStyle(tx.status))}>
                              {getStatusText(tx.status)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div
                          className={cn(
                            'text-sm font-semibold',
                            isExpired ? 'text-[#6b7280] line-through' : 'text-[#111827]',
                          )}
                        >
                          $
                          {tx.quote.sourceAmount.toFixed(2)}
                        </div>
                        <div className="text-[11px] text-[#6b7280]">
                          {countryConfig.symbol}
                          {localAmount}
                          {' '}
                          {countryConfig.currency}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#9ca3af]" />
                    </button>
                  )
                })
                : recentTransactionsFallback.slice(0, 2).map((tx, i) => {
                  const countryConfig = RECENT_COUNTRY_CONFIG[tx.country] ?? RECENT_COUNTRY_CONFIG.COP
                  return (
                    <button
                      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f9fafb]"
                      key={`${tx.merchant}-${tx.time}-${i}`}
                      onClick={onHistoryClick}
                      type="button"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] border border-[#e5e7eb] bg-[#f9fafb] text-xl">
                        {countryConfig.flag}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#111827]">{tx.merchant}</div>
                        <div className="mt-0.5 text-xs text-[#6b7280]">
                          {tx.country === 'COP' ? 'Colombia' : 'Brazil'}
                          {' · '}
                          {tx.time}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-[#111827]">
                          {countryConfig.symbol}
                          {tx.localAmount}
                          {' '}
                          {countryConfig.currency}
                        </div>
                        <div className="text-[11px] text-[#6b7280]">
                          $
                          {tx.usdcAmount}
                          {' '}
                          {selectedTokenLabel}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#9ca3af]" />
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
