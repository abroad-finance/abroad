import { useTranslate } from '@tolgee/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import React from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { ASSET_URLS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

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

export interface HomeScreenProps {
  balance: string
  isAuthenticated: boolean
  onConnectWallet: () => void
  onHistoryClick: () => void
  onOpenChainModal?: () => void
  onOpenQr: () => void
  onGoToManual: () => void
  recentTransactions: Array<{
    country: string
    localAmount: string
    merchant: string
    time: string
    usdcAmount: string
  }>
  selectedChainKey?: string
  selectedTokenLabel: string
  targetCurrency: TargetCurrency
}

export default function HomeScreen({
  balance,
  isAuthenticated,
  onConnectWallet,
  onHistoryClick,
  onOpenChainModal,
  onOpenQr,
  onGoToManual,
  recentTransactions,
  selectedChainKey,
  selectedTokenLabel,
  targetCurrency,
}: HomeScreenProps): React.JSX.Element {
  const { t } = useTranslate()
  const balanceNum = parseFloat(balance.replace(/,/g, '')) || 0

  // Unauthenticated view - Hero landing page
  if (!isAuthenticated) {
    return (
      <main className="relative min-h-full flex-1 flex-col items-center justify-center px-4 pt-8 pb-20 overflow-hidden">
        {/* Decorative blur orb - only in light mode */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--ab-green)]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 w-full max-w-4xl mx-auto text-center">
          {/* Live badge */}
          <div className="inline-flex items-center gap-2 bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 rounded-full px-4 py-1.5 mb-8 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              {t('home.live_badge', 'Live in Colombia & Brazil')}
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-[var(--ab-text)] mb-6 leading-tight">
            {t('home.headline_1', 'Spend your')}
            <br className="hidden md:block" />
            {' '}stablecoins at
            <br />
            <span className="text-[var(--ab-green)] bg-clip-text text-transparent bg-gradient-to-r from-emerald-500 to-teal-400">
              {t('home.headline_2', 'local merchants.')}
            </span>
          </h1>

          {/* Subline */}
          <p className="text-lg md:text-xl text-[var(--ab-text-secondary)] max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('home.subline', 'Connect your wallet, scan a QR code, and pay — the merchant receives local currency instantly.')}
          </p>

          {/* Chain badges */}
          <div className="flex flex-wrap justify-center gap-4 mb-12">
            {CHAIN_CONFIG.map(({ icon, key, label }) => (
              <div
                key={key}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full shadow-sm border transition-colors cursor-default',
                  key === 'stellar' && 'bg-[var(--ab-chain-stellar-bg)] border-[var(--ab-chain-stellar)]/20',
                  key === 'celo' && 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800/50',
                  key === 'solana' && 'bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800/50',
                )}
              >
                <img
                  alt={label}
                  className="w-5 h-5"
                  src={icon}
                />
                <span className={cn(
                  'font-semibold text-sm',
                  key === 'stellar' && 'text-[var(--ab-chain-stellar)]',
                  key === 'celo' && 'text-yellow-700 dark:text-yellow-300',
                  key === 'solana' && 'text-purple-700 dark:text-purple-300',
                )}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <button
            className="group bg-[var(--ab-green)] hover:opacity-90 text-white text-lg font-bold py-4 px-8 rounded-full shadow-lg hover:shadow-[var(--ab-green)]/30 dark:hover:shadow-[var(--ab-green)]/10 transition-all duration-300 transform hover:-translate-y-1 flex items-center justify-center gap-2 mx-auto"
            onClick={onConnectWallet}
            type="button"
          >
            {t('home.cta_connect', 'Connect Wallet to Start')}
            <ChevronRight className="group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Trust badges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto mt-11">
            {[
              { icon: '⚡', label: t('home.trust_settlement', '< 3s settlement') },
              { icon: '💰', label: t('home.trust_fees', 'Low fees') },
              { icon: '🔒', label: t('home.trust_custodial', 'Non-custodial') },
            ].map(({ icon, label }) => (
              <div
                key={label}
                className="flex items-center justify-center gap-2 text-[var(--ab-text-secondary)]"
              >
                <span className="text-xl">{icon}</span>
                <span className="font-medium text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  // Authenticated view - Dashboard
  const c = targetCurrency === TargetCurrency.BRL ? COUNTRIES.BRL : COUNTRIES.COP
  const localBalance = c.decimals === 0
    ? Math.round(balanceNum * c.rate).toLocaleString('es-CO')
    : (balanceNum * c.rate).toFixed(c.decimals)
  const otherCurrency = targetCurrency === TargetCurrency.BRL ? COUNTRIES.COP : COUNTRIES.BRL
  const otherBalance = otherCurrency.decimals === 0
    ? Math.round(balanceNum * otherCurrency.rate).toLocaleString('es-CO')
    : (balanceNum * otherCurrency.rate).toFixed(otherCurrency.decimals)

  // Get chain from selectedChainKey
  const chainKey = selectedChainKey?.toLowerCase().split(':')[0] ?? 'stellar'
  const chainInfo = CHAIN_MAP[chainKey] ?? CHAIN_MAP.stellar

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-8 md:py-10">
      <div className="w-full max-w-[480px]">
        <div className="mb-9 text-center">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[2px] text-[var(--ab-text-muted)]">
            {t('home.your_balance', 'Your Balance')}
          </p>
          <p className="font-cereal text-[36px] font-bold tracking-[-1px] text-[var(--ab-text)]">
            ${balance}
            {' '}
            <span className="text-base text-[var(--ab-green)]">{selectedTokenLabel}</span>
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-[var(--ab-bg-muted)] px-3 py-1 text-xs font-semibold text-[var(--ab-text-muted)]">
              {c.flag}
              {' ≈ '}
              {targetCurrency === TargetCurrency.BRL ? 'R$' : '$'}
              {localBalance}
              {' '}
              {targetCurrency}
            </span>
            <span className="rounded-full bg-[var(--ab-bg-muted)] px-3 py-1 text-xs font-semibold text-[var(--ab-text-muted)]">
              {otherCurrency.flag}
              {' ≈ '}
              {targetCurrency === TargetCurrency.BRL ? '$' : 'R$'}
              {otherBalance}
              {' '}
              {targetCurrency === TargetCurrency.BRL ? 'COP' : 'BRL'}
            </span>
          </div>

          {/* Chain selector pill */}
          {onOpenChainModal && (
            <button
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{ backgroundColor: chainInfo.bg, borderColor: `${chainInfo.color}25`, borderWidth: '1.5px', color: chainInfo.color }}
              onClick={onOpenChainModal}
              type="button"
            >
              <img alt={chainInfo.name} className="h-3.5 w-3.5" src={chainInfo.icon} />
              {selectedTokenLabel} on {chainInfo.name}
              <ChevronDown className="h-3 w-3" />
            </button>
          )}
        </div>

        <button
          className={cn(
            'mb-3.5 flex w-full items-center gap-5 rounded-[24px] border-0 p-7 text-left shadow-[0_8px_32px_rgba(15,190,123,0.2)]',
            'bg-gradient-to-br from-[var(--ab-green)] to-[var(--ab-green-dark)] text-white',
            'transition-[transform,box-shadow] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
            'hover:scale-[1.01] hover:shadow-[0_12px_40px_rgba(15,190,123,0.25)] active:scale-[0.99]',
          )}
          onClick={onOpenQr}
          type="button"
        >
          <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[18px] bg-white/20 text-[28px]">
            📱
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-cereal mb-1 text-[19px] font-semibold">
              {t('home.scan_qr_pay', 'Scan QR & Pay')}
            </div>
            <div className="text-[13px] text-white/80">
              {t('home.scan_qr_desc', 'Scan a Bre-B or PIX QR — amount and merchant fill automatically')}
            </div>
          </div>
          <ChevronRight className="h-6 w-6 shrink-0 text-white/60" />
        </button>

        <button
          className={cn(
            'flex w-full items-center gap-5 rounded-[20px] border-[1.5px] border-[var(--ab-border)] bg-[var(--ab-bg-card)] p-5 text-left',
            'transition-[border-color] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
            'hover:border-[var(--ab-green-border)]',
          )}
          onClick={onGoToManual}
          type="button"
        >
          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-[var(--ab-bg-muted)] text-2xl">
            ⌨️
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-cereal mb-0.5 text-[17px] font-semibold text-[var(--ab-text)]">
              {t('home.enter_manual', 'Enter Amount Manually')}
            </div>
            <div className="text-[13px] text-[var(--ab-text-muted)]">
              {t('home.enter_manual_desc', 'Type amount and recipient to send directly')}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-[var(--ab-text-muted)]" />
        </button>

        {recentTransactions.length > 0 && (
          <div className="mt-8">
            <div className="mb-3.5 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[2px] text-[var(--ab-text-muted)]">
                {t('home.recent', 'Recent')}
              </span>
              <button
                className="text-xs font-semibold text-[var(--ab-green)]"
                onClick={onHistoryClick}
                type="button"
              >
                {t('home.see_all', 'See all')} →
              </button>
            </div>
            <div className="divide-y divide-[var(--ab-border)]">
              {recentTransactions.slice(0, 2).map((tx, i) => (
                <button
                  className="flex w-full items-center gap-3 py-3 text-left"
                  key={i}
                  onClick={onHistoryClick}
                  type="button"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ab-bg-muted)] text-lg">
                    {tx.country === 'COP' ? '🇨🇴' : '🇧🇷'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--ab-text)]">{tx.merchant}</div>
                    <div className="text-[11px] text-[var(--ab-text-muted)]">{tx.time}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--ab-text)]">
                      {tx.country === 'COP' ? '$' : 'R$'}
                      {tx.localAmount}
                      {' '}
                      {tx.country}
                    </div>
                    <div className="text-[11px] text-[var(--ab-text-muted)]">
                      $
                      {tx.usdcAmount}
                      {' '}
                      {selectedTokenLabel}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
