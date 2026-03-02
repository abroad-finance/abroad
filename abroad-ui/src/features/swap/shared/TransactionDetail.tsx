import { useTranslate } from '@tolgee/react'
import {
  ArrowLeft, ArrowRight, ChevronDown, ChevronUp, HelpCircle, MapPin, Store,
} from 'lucide-react'
import React, { useState } from 'react'

import { TransactionListItem } from '../../../api'
import { ASSET_URLS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'
import { formatChainLabel } from '../utils/corridorHelpers'

export interface TransactionDetailProps {
  formatDate?: (dateString: string) => string
  formatDateWithTime: (dateString: string) => string
  getStatusStyle?: (status: string) => string
  getStatusText: (status: string) => string
  onBack: () => void
  onSupport: () => void
  transaction: TransactionListItem
}

const CHAIN_ICON_MAP: Record<string, string> = {
  CELO: ASSET_URLS.CELO_CHAIN_ICON,
  SOLANA: ASSET_URLS.SOLANA_CHAIN_ICON,
  STELLAR: ASSET_URLS.STELLAR_CHAIN_ICON,
  celo: ASSET_URLS.CELO_CHAIN_ICON,
  solana: ASSET_URLS.SOLANA_CHAIN_ICON,
  stellar: ASSET_URLS.STELLAR_CHAIN_ICON,
}

const COUNTRY_CONFIG: Record<string, { flagUrl: string, location: string, name: string, rail: string, symbol: string }> = {
  BRL: { flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg', location: 'Brazil', name: 'BRL', rail: 'PIX', symbol: 'R$' },
  COP: { flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg', location: 'Colombia', name: 'COP', rail: 'Bre-B', symbol: '$' },
}

const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: ASSET_URLS.USDC_TOKEN_ICON,
  USDT: ASSET_URLS.USDT_TOKEN_ICON,
}

const TransactionDetail: React.FC<TransactionDetailProps> = ({
  formatDateWithTime,
  getStatusText,
  onBack,
  onSupport,
  transaction,
}) => {
  const { t } = useTranslate()
  const [showTechnical, setShowTechnical] = useState(false)

  const tc = transaction.quote.targetCurrency
  const country = COUNTRY_CONFIG[tc] ?? COUNTRY_CONFIG.COP
  const isExpired = transaction.status === 'PAYMENT_EXPIRED' || transaction.status === 'PAYMENT_FAILED' || transaction.status === 'WRONG_AMOUNT'

  const locale = tc === 'BRL' ? 'pt-BR' : 'es-CO'
  const targetFormatted = transaction.quote.targetAmount.toLocaleString(
    locale,
    tc === 'COP' ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : { maximumFractionDigits: 2, minimumFractionDigits: 2 },
  )

  const rate = transaction.quote.sourceAmount > 0
    ? (transaction.quote.targetAmount / transaction.quote.sourceAmount).toLocaleString(locale, { maximumFractionDigits: 2 })
    : '—'

  const networkKey = (transaction.quote.network ?? 'STELLAR').toUpperCase()
  const chainIcon = CHAIN_ICON_MAP[networkKey] ?? CHAIN_ICON_MAP.STELLAR
  const chainLabel = formatChainLabel(transaction.quote.network ?? 'Stellar')

  const txRef = transaction as unknown as { onChainId?: string }
  const shortRecipient = transaction.accountNumber.length > 12
    ? `${transaction.accountNumber.slice(0, 4)}...${transaction.accountNumber.slice(-4)}`
    : transaction.accountNumber

  const cryptoCurrency = (transaction.quote.cryptoCurrency ?? 'USDC').toUpperCase()
  const tokenIcon = TOKEN_ICON_MAP[cryptoCurrency] ?? ASSET_URLS.USDC_TOKEN_ICON

  return (
    <div className="flex flex-col">
      {/* Header — Figma 1:254 */}
      <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4 pt-1">
        <button
          aria-label={t('wallet_details.actions.back', 'Back')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-ab-hover"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft className="h-5 w-5 text-ab-text" strokeWidth={2} />
        </button>
        <h3 className="font-cereal text-lg font-bold text-[#0f172a]">
          {t('wallet_details.transactions.detail_title', 'Transaction Details')}
        </h3>
        <div className="flex gap-2">
          <button
            aria-label={t('wallet_details.actions.support', 'Support')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-ab-hover"
            onClick={onSupport}
            type="button"
          >
            <HelpCircle className="h-5 w-5 text-ab-text-muted" />
          </button>
        </div>
      </div>

      {/* Status section — Figma 1:268 */}
      <div className="flex flex-col items-center py-8">
        <div
          className={cn(
            'mb-4 flex h-16 w-16 shrink-0 items-center justify-center rounded-full',
            isExpired ? 'bg-red-100' : 'bg-[#d1fae5]',
          )}
        >
          {isExpired
            ? (
                <svg className="h-8 w-8 text-ab-error" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )
            : (
                <svg className="h-8 w-8 text-[#059669]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
                </svg>
              )}
        </div>
        <h4 className={cn('font-cereal text-xl font-bold', isExpired ? 'text-ab-error' : 'text-[#059669]')}>
          {isExpired ? t('wallet_details.status.expired', 'Payment Expired') : t('wallet_details.status.completed', 'Payment Completed')}
        </h4>
        <p className="mt-1 text-sm text-[#64748b]">
          {formatDateWithTime(transaction.createdAt)}
        </p>
      </div>

      {/* Merchant/Recipient — Figma 1:277 */}
      <div className="flex flex-col items-center pb-6">
        <div className="relative mb-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border-2 border-white bg-ab-bg-muted shadow-sm">
          <Store className="h-5 w-5 text-ab-text-muted" strokeWidth={1.5} />
          <img
            alt={country.location}
            className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-white object-cover shadow-sm"
            src={country.flagUrl}
          />
        </div>
        <h5 className="font-cereal text-2xl font-bold text-[#0f172a]">
          {transaction.accountNumber}
        </h5>
        <div className="flex items-center gap-1 text-sm text-[#64748b]">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span>{country.location}</span>
        </div>
      </div>

      {/* Currency comparison card — Figma 1:287 */}
      <div className="mb-6 rounded-2xl border border-[#f1f5f9] bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
              {t('wallet_details.transactions.you_paid', 'You Paid')}
            </p>
            <div className="flex items-center gap-2">
              <span className="font-cereal text-xl font-bold text-[#0f172a]">
                {transaction.quote.sourceAmount.toFixed(2)}
              </span>
              <span className="flex items-center gap-1.5 rounded bg-[#f1f5f9] px-2 py-0.5 text-xs font-semibold text-[#475569]">
                <img alt={cryptoCurrency} className="h-4 w-4" src={tokenIcon} />
                {transaction.quote.cryptoCurrency ?? 'USDC'}
              </span>
            </div>
          </div>
          <ArrowRight className="h-8 w-8 shrink-0 text-[#94a3b8]" strokeWidth={2} />
          <div className="text-right">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#94a3b8]">
              {t('wallet_details.transactions.merchant_got', 'Merchant Got')}
            </p>
            <div className="flex items-center justify-end gap-2">
              <span className="font-cereal text-xl font-bold text-[#0f172a]">
                {targetFormatted}
              </span>
              <span className="flex items-center gap-1.5 rounded bg-[#f1f5f9] px-2 py-0.5 text-xs font-semibold text-[#475569]">
                <img alt={country.name} className="h-4 w-4" src={country.flagUrl} />
                {country.name}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-[#f8fafc] pt-4">
          <span className="text-xs text-[#94a3b8]">
            {t('wallet_details.transactions.exchange_rate', 'Exchange Rate')}
          </span>
          <span className="text-xs font-medium text-[#0f172a]">
            1 {transaction.quote.cryptoCurrency ?? 'USDC'} ≈ {rate} {country.name}
          </span>
        </div>
      </div>

      {/* Transaction summary — Figma 1:313 */}
      <div className="mb-4">
        <h6 className="mb-4 px-1 text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
          {t('wallet_details.transactions.summary', 'Transaction Summary')}
        </h6>
        <div className="space-y-1">
          <SummaryRow label={t('wallet_details.transactions.status', 'Status')}>
            <span className={cn('flex items-center gap-1 font-semibold', isExpired ? 'text-ab-error' : 'text-[#0f172a]')}>
              {!isExpired && <span className="h-2 w-2 shrink-0 rounded-full bg-[#10b981]" />}
              {getStatusText(transaction.status)}
            </span>
          </SummaryRow>
          <SummaryRow label={t('wallet_details.transactions.payment_rail', 'Payment Rail')}>
            <span className="flex items-center gap-1.5 font-semibold text-[#0f172a]">
              <img alt={country.location} className="h-4 w-4" src={country.flagUrl} />
              {country.rail}
            </span>
          </SummaryRow>
          <SummaryRow label={t('wallet_details.transactions.network', 'Network')}>
            <span className="flex items-center gap-1.5 font-semibold text-[#0f172a]">
              <img alt={chainLabel} className="h-5 w-5" src={chainIcon} />
              {chainLabel}
            </span>
          </SummaryRow>
          <SummaryRow label={t('wallet_details.transactions.token', 'Token')}>
            <span className="flex items-center gap-1.5 font-semibold text-[#0f172a]">
              <img alt={cryptoCurrency} className="h-4 w-4" src={tokenIcon} />
              {transaction.quote.cryptoCurrency ?? 'USDC'} (Circle)
            </span>
          </SummaryRow>
          <SummaryRow label={t('wallet_details.transactions.recipient_id', 'Recipient ID')}>
            <span className="rounded bg-[#f1f5f9] px-2 py-1 font-mono text-sm text-[#0f172a]">
              {shortRecipient}
            </span>
          </SummaryRow>
        </div>
      </div>

      {/* Technical details collapsible — Figma 1:356 */}
      <div className="mb-6 overflow-hidden rounded-xl border border-[#e2e8f0]">
        <button
          className="flex w-full items-center justify-between bg-[#f8fafc] px-4 py-4 transition-colors hover:bg-ab-hover"
          onClick={() => setShowTechnical(s => !s)}
          type="button"
        >
          <span className="font-cereal text-sm font-bold text-[#0f172a]">
            {t('wallet_details.transactions.technical_details', 'Technical Details')}
          </span>
          {showTechnical ? <ChevronUp className="h-4 w-4 text-ab-text-muted" /> : <ChevronDown className="h-4 w-4 text-ab-text-muted" />}
        </button>
        {showTechnical && (
          <div className="border-t border-[#e2e8f0] bg-white px-4 py-4">
            {txRef.onChainId && (
              <div className="mb-4">
                <p className="mb-1 text-[10px] font-bold uppercase text-[#94a3b8]">
                  {t('wallet_details.transactions.tx_hash', 'Transaction Hash')}
                </p>
                <p className="break-all font-mono text-xs text-[#475569]">{txRef.onChainId}</p>
              </div>
            )}
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase text-[#94a3b8]">
                {t('wallet_details.transactions.transaction_id', 'Transaction ID')}
              </p>
              <p className="break-all font-mono text-xs text-[#475569]">{transaction.id}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-[#64748b]">{label}</span>
      {children}
    </div>
  )
}

export default TransactionDetail
