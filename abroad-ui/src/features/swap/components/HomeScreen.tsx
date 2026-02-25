import { useTranslate } from '@tolgee/react'
import { ChevronRight, ChevronDown } from 'lucide-react'
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
  const c = targetCurrency === TargetCurrency.BRL ? COUNTRIES.BRL : COUNTRIES.COP

  if (!isAuthenticated) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 md:py-16">
        <div className="w-full max-w-[500px] text-center">
          <div
            className={cn(
              'mb-7 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold',
              'border-[var(--ab-green-border)] bg-[var(--ab-green-soft)] text-[var(--ab-green-dark)]',
            )}
          >
            <span
              className="h-2 w-2 rounded-full bg-[var(--ab-green)]"
              style={{ animation: 'ab-blink 2s infinite' }}
            />
            {t('home.live_badge', 'Live in Colombia & Brazil')}
          </div>
          <h1 className="font-cereal mb-4 text-[44px] font-bold leading-tight tracking-[-1px] text-[var(--ab-text)]">
            {t('home.headline_1', 'Spend your stablecoins at')}
            <br />
            <span className="text-[var(--ab-green)]">
              {t('home.headline_2', 'local merchants.')}
            </span>
          </h1>
          <p className="mx-auto mb-5 max-w-[420px] text-[17px] leading-snug text-[var(--ab-text-secondary)]">
            {t('home.subline', 'Connect your wallet, scan a QR code, and pay — the merchant receives local currency instantly.')}
          </p>
          <div className="mb-9 flex flex-wrap justify-center gap-3">
            {CHAIN_CONFIG.map(({ icon, key, label }) => (
              <span
                key={key}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold',
                  key === 'stellar' && 'bg-[var(--ab-chain-stellar-bg)] text-[var(--ab-chain-stellar)]',
                  key === 'celo' && 'bg-[var(--ab-chain-celo-bg)] text-[var(--ab-chain-celo)]',
                  key === 'solana' && 'bg-[var(--ab-chain-solana-bg)] text-[var(--ab-chain-solana)]',
                )}
              >
                <img
                  alt={label}
                  className="h-4 w-4"
                  src={icon}
                />
                {label}
              </span>
            ))}
          </div>
          <button
            className={cn(
              'font-cereal rounded-2xl bg-[var(--ab-green)] px-10 py-4 text-base font-semibold text-white',
              'transition-[transform,opacity] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
              'hover:opacity-95 active:scale-[0.98]',
            )}
            onClick={onConnectWallet}
            type="button"
          >
            {t('home.cta_connect', 'Connect Wallet to Start')} →
          </button>
          <div className="mt-11 flex flex-wrap justify-center gap-5">
            {[
              { i: '⚡', l: t('home.trust_settlement', '< 3s settlement') },
              { i: '💰', l: t('home.trust_fees', 'Low fees') },
              { i: '🔒', l: t('home.trust_custodial', 'Non-custodial') },
            ].map(({ i, l }) => (
              <span
                key={l}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ab-text-secondary)]"
              >
                {i} {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

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
