import { useTranslate } from '@tolgee/react'
import { ChevronDown } from 'lucide-react'
import React, { useState } from 'react'

import { BottomSheet, StatusBadge } from '@/shared/components'
import { ASSET_URLS } from '@/shared/constants'
import { cn } from '@/shared/utils'

import type { TxDetailItem } from '../constants'

const CHAIN_CONFIG: Record<string, { bg: string, icon: string }> = {
  Celo: { bg: 'var(--ab-chain-celo-bg)', icon: ASSET_URLS.CELO_CHAIN_ICON },
  Solana: { bg: 'var(--ab-chain-solana-bg)', icon: ASSET_URLS.SOLANA_CHAIN_ICON },
  Stellar: { bg: 'var(--ab-chain-stellar-bg)', icon: ASSET_URLS.STELLAR_CHAIN_ICON },
}

const COUNTRY_CONFIG: Record<string, { currency: string, flagUrl: string, name: string, rail: string, symbol: string }> = {
  br: {
    currency: 'BRL', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg', name: 'Brazil', rail: 'PIX', symbol: 'R$',
  },
  co: {
    currency: 'COP', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg', name: 'Colombia', rail: 'Bre-B', symbol: '$',
  },
}

export interface TxDetailSheetProps {
  onClose: () => void
  tx: null | TxDetailItem
}

export default function TxDetailSheet({ onClose, tx }: Readonly<TxDetailSheetProps>): null | React.JSX.Element {
  const { t } = useTranslate()
  const [showTechnical, setShowTechnical] = useState(false)

  if (!tx) return null

  const isExpired = tx.status === 'expired'
  const country = COUNTRY_CONFIG[tx.country] ?? COUNTRY_CONFIG.co
  const chain = CHAIN_CONFIG[tx.chain] ?? CHAIN_CONFIG.Stellar

  return (
    <BottomSheet onClose={onClose}>
      <div className="px-6 pb-9 pt-1">
        <div className="mb-5 flex items-center justify-center gap-2.5 py-3.5">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full border-[1.5px]',
              isExpired ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[var(--ab-green-border)] bg-[var(--ab-green-soft)]',
            )}
          >
            {isExpired
              ? (
                  <svg className="h-5 w-5 text-[var(--ab-red)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )
              : (
                  <svg className="h-5 w-5 text-[var(--ab-green)]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
          </div>
          <div>
            <div className="font-cereal text-base font-bold text-[var(--ab-text)]">
              {isExpired ? t('tx_detail.expired', 'Payment Expired') : t('tx_detail.completed', 'Payment Completed')}
            </div>
            <div className="text-xs text-[var(--ab-text-muted)]">{tx.date}</div>
          </div>
        </div>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] border border-[var(--ab-border)] bg-[var(--ab-bg-muted)]">
            <img alt={country.currency} className="h-10 w-10 rounded-full" src={country.flagUrl} />
          </div>
          <div className="font-cereal text-lg font-bold text-[var(--ab-text)]">{tx.merchant}</div>
          <div className="text-[13px] text-[var(--ab-text-muted)]">
            {tx.location ?? country.name}
          </div>
        </div>

        <div className="mb-6 flex gap-2.5">
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('tx_detail.you_paid', 'You paid')}</div>
            <div className="font-cereal text-[22px] font-bold text-[var(--ab-text)]">
              $
              {tx.usdcAmount}
            </div>
            <div className="text-xs font-semibold text-[var(--ab-green)]">{tx.token}</div>
          </div>
          <div className="flex items-center">
            <svg className="h-5 w-5 text-[var(--ab-text-muted)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M5 12h14m-7-7l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('tx_detail.merchant_got', 'Merchant got')}</div>
            <div className="font-cereal text-[22px] font-bold text-[var(--ab-text)]">
              {country.symbol}
              {tx.localAmount}
            </div>
            <div className="text-xs font-semibold text-[var(--ab-text-secondary)]">{country.currency}</div>
          </div>
        </div>

        <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--ab-border)]">
          {[
            { badge: true, label: t('tx_detail.status', 'Status'), value: isExpired ? t('tx_detail.status_expired', 'Expired') : t('tx_detail.status_completed', 'Completed') },
            { icon: country.flagUrl, label: t('tx_detail.payment_rail', 'Payment rail'), value: country.rail },
            { label: t('tx_detail.fee', 'Fee'), value: `$${tx.fee} ${tx.token}` },
            { label: t('tx_detail.settlement_time', 'Settlement time'), value: tx.settlementTime === '—' ? '—' : `⚡ ${tx.settlementTime}` },
            { icon: chain.icon, label: t('tx_detail.network', 'Network'), value: tx.chain },
            { label: t('tx_detail.token', 'Token'), value: tx.token },
            { label: t('tx_detail.recipient', 'Recipient'), value: tx.accountNumber },
          ].map((row, i) => (
            <div
              className={cn(
                'flex items-center justify-between px-4 py-3',
                i % 2 === 0 ? 'bg-[#FAFBFC]' : 'bg-white',
              )}
              key={row.label}
            >
              <span className="text-[13px] text-[var(--ab-text-muted)]">{row.label}</span>
              {row.badge
                ? (
                    <StatusBadge variant={isExpired ? 'expired' : 'completed'}>{row.value}</StatusBadge>
                  )
                : (
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ab-text)]">
                      {row.icon && <img alt="" className="h-4 w-4" src={row.icon} />}
                      {row.value}
                    </span>
                  )}
            </div>
          ))}
        </div>

        <button
          className="flex w-full items-center justify-between rounded-[14px] border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-3.5"
          onClick={() => setShowTechnical(s => !s)}
          type="button"
        >
          <span className="font-cereal text-[13px] font-bold text-[var(--ab-text-secondary)]">{t('tx_detail.technical_details', 'Technical Details')}</span>
          <ChevronDown className={cn('h-4 w-4 text-[var(--ab-text-muted)] transition-transform', showTechnical && 'rotate-180')} />
        </button>

        {showTechnical && (
          <div className="mt-0 overflow-hidden rounded-b-[14px] border border-t-0 border-[var(--ab-border)]">
            {[
              { l: 'Transaction ID', v: tx.transactionId ?? '—' },
              { l: 'Partner ID', v: tx.partnerId ?? '—' },
              { l: 'Account number', v: tx.accountNumber },
              { l: 'Country code', v: tx.country.toUpperCase() },
              { l: 'Source amount', v: `${tx.usdcAmount} ${tx.token}` },
              { l: 'Target amount', v: `${tx.localAmount} ${country.currency}` },
              { l: 'Crypto currency', v: tx.token },
              { l: 'Network', v: tx.chain.toUpperCase() },
            ].map((row, i) => (
              <div
                className={cn(
                  'flex justify-between gap-2 px-4 py-2.5',
                  i % 2 === 0 ? 'bg-[#FAFBFC]' : 'bg-white',
                )}
                key={row.l}
              >
                <span className="shrink-0 text-[11px] text-[var(--ab-text-muted)]">{row.l}</span>
                <span className="max-w-[60%] break-all text-right text-[11px] font-medium text-[var(--ab-text-secondary)] font-mono">
                  {row.v}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
