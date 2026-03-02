import { ChevronDown } from 'lucide-react'
import React, { useState } from 'react'

import { ASSET_URLS } from '../../../shared/constants'
import { BottomSheet, StatusBadge } from '../../../components/ui'
import { cn } from '../../../shared/utils'

export interface TxDetailItem {
  accountNumber: string
  chain: string
  country: 'br' | 'co'
  date: string
  fee: string
  localAmount: string
  merchant: string
  location?: string
  partnerId?: string
  settlementTime: string
  status: 'completed' | 'expired' | 'pending'
  token: string
  transactionId?: string
  usdcAmount: string
}

const CHAIN_CONFIG: Record<string, { icon: string, bg: string }> = {
  Celo: { icon: ASSET_URLS.CELO_CHAIN_ICON, bg: 'var(--ab-chain-celo-bg)' },
  Solana: { icon: ASSET_URLS.SOLANA_CHAIN_ICON, bg: 'var(--ab-chain-solana-bg)' },
  Stellar: { icon: ASSET_URLS.STELLAR_CHAIN_ICON, bg: 'var(--ab-chain-stellar-bg)' },
}

const COUNTRY_CONFIG: Record<string, { flag: string, symbol: string, currency: string, rail: string, name: string }> = {
  br: { flag: '🇧🇷', symbol: 'R$', currency: 'BRL', rail: 'PIX', name: 'Brazil' },
  co: { flag: '🇨🇴', symbol: '$', currency: 'COP', rail: 'Bre-B', name: 'Colombia' },
}

export interface TxDetailSheetProps {
  onClose: () => void
  tx: TxDetailItem | null
}

export default function TxDetailSheet({ onClose, tx }: Readonly<TxDetailSheetProps>): React.JSX.Element | null {
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
            {isExpired ? (
              <svg className="h-5 w-5 text-[var(--ab-red)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5 text-[var(--ab-green)]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </div>
          <div>
            <div className="font-cereal text-base font-bold text-[var(--ab-text)]">
              {isExpired ? 'Payment Expired' : 'Payment Completed'}
            </div>
            <div className="text-xs text-[var(--ab-text-muted)]">{tx.date}</div>
          </div>
        </div>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] border border-[var(--ab-border)] bg-[var(--ab-bg-muted)] text-2xl">
            {country.flag}
          </div>
          <div className="font-cereal text-lg font-bold text-[var(--ab-text)]">{tx.merchant}</div>
          <div className="text-[13px] text-[var(--ab-text-muted)]">
            {tx.location ?? country.name}
          </div>
        </div>

        <div className="mb-6 flex gap-2.5">
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">You paid</div>
            <div className="font-cereal text-[22px] font-bold text-[var(--ab-text)]">${tx.usdcAmount}</div>
            <div className="text-xs font-semibold text-[var(--ab-green)]">{tx.token}</div>
          </div>
          <div className="flex items-center">
            <svg className="h-5 w-5 text-[var(--ab-text-muted)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-7-7l7 7-7 7" />
            </svg>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-4 py-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">Merchant got</div>
            <div className="font-cereal text-[22px] font-bold text-[var(--ab-text)]">{country.symbol}{tx.localAmount}</div>
            <div className="text-xs font-semibold text-[var(--ab-text-secondary)]">{country.currency}</div>
          </div>
        </div>

        <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--ab-border)]">
          {[
            { label: 'Status', value: isExpired ? 'Expired' : 'Completed', badge: true },
            { label: 'Payment rail', value: `${country.flag} ${country.rail}` },
            { label: 'Fee', value: `$${tx.fee} ${tx.token}` },
            { label: 'Settlement time', value: tx.settlementTime === '—' ? '—' : `⚡ ${tx.settlementTime}` },
            { label: 'Network', value: tx.chain, icon: chain.icon },
            { label: 'Token', value: tx.token },
            { label: 'Recipient', value: tx.accountNumber },
          ].map((row, i) => (
            <div
              className={cn(
                'flex items-center justify-between px-4 py-3',
                i % 2 === 0 ? 'bg-[#FAFBFC]' : 'bg-white',
              )}
              key={row.label}
            >
              <span className="text-[13px] text-[var(--ab-text-muted)]">{row.label}</span>
              {row.badge ? (
                <StatusBadge variant={isExpired ? 'expired' : 'completed'}>{row.value}</StatusBadge>
              ) : (
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
          onClick={() => setShowTechnical((s) => !s)}
          type="button"
        >
          <span className="font-cereal text-[13px] font-bold text-[var(--ab-text-secondary)]">Technical Details</span>
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
