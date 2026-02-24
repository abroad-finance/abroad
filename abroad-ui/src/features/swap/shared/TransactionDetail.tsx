import { useTranslate } from '@tolgee/react'
import {
  ArrowLeft, Calendar, ChevronDown, ChevronUp, Hash, HelpCircle, Send, Wallet,
} from 'lucide-react'
import React, { useMemo, useState } from 'react'

import { TransactionListItem } from '../../../api'

export interface TransactionDetailProps {
  formatDate: (dateString: string) => string
  formatDateWithTime: (dateString: string) => string
  getStatusStyle: (status: string) => string
  getStatusText: (status: string) => string
  onBack: () => void
  onSupport: () => void
  transaction: TransactionListItem
}

type TableRow = { label: string, value: string }

const LABEL_MAP: Record<string, string> = {
  accountNumber: 'Account number',
  createdAt: 'Date & time',
  id: 'ID',
  partnerUserId: 'Partner user ID',
  sourceAmount: 'Source amount (USDC)',
  status: 'Status',
  targetAmount: 'Target amount',
  targetCurrency: 'Target currency',
  transactionReference: 'Transaction reference',
}

function labelFromKey(key: string): string {
  return LABEL_MAP[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
}

const TOP_LEVEL_ORDER = [
  'id',
  'partnerUserId',
  'accountNumber',
  'status',
  'createdAt',
  'transactionReference',
  'quote',
]

function flattenToTableRows(
  transaction: TransactionListItem,
  formatDateWithTime: (dateString: string) => string,
  getStatusText: (status: string) => string,
): TableRow[] {
  const rows: TableRow[] = []
  const tx = transaction as unknown as Record<string, unknown>
  const keys = Object.keys(tx)
  const ordered = [...TOP_LEVEL_ORDER.filter(k => keys.includes(k)), ...keys.filter(k => !TOP_LEVEL_ORDER.includes(k))]
  for (const key of ordered) {
    if (key === 'quote' && tx.quote != null && typeof tx.quote === 'object') {
      const q = tx.quote as Record<string, unknown>
      for (const qk of Object.keys(q)) {
        rows.push({ label: labelFromKey(qk), value: String(q[qk] ?? '') })
      }
      continue
    }
    if (key === 'createdAt' && typeof tx[key] === 'string') {
      rows.push({ label: labelFromKey(key), value: formatDateWithTime(tx[key] as string) })
      continue
    }
    if (key === 'status' && typeof tx[key] === 'string') {
      rows.push({ label: labelFromKey(key), value: getStatusText(tx[key] as string) })
      continue
    }
    if (tx[key] != null && typeof tx[key] !== 'object') {
      rows.push({ label: labelFromKey(key), value: String(tx[key]) })
    }
  }
  return rows
}

const TransactionDetail: React.FC<TransactionDetailProps> = ({
  formatDateWithTime,
  getStatusStyle,
  getStatusText,
  onBack,
  onSupport,
  transaction,
}) => {
  const { t } = useTranslate()
  const [showFullDetails, setShowFullDetails] = useState(false)
  const targetSymbol = transaction.quote.targetCurrency === 'BRL' ? 'R$' : '$'
  const targetFormatted = transaction.quote.targetAmount.toLocaleString(
    transaction.quote.targetCurrency === 'BRL' ? 'pt-BR' : 'es-CO',
    { maximumFractionDigits: 2, minimumFractionDigits: 2 },
  )

  const tableRows = useMemo(
    () => flattenToTableRows(transaction, formatDateWithTime, getStatusText),
    [
      transaction,
      formatDateWithTime,
      getStatusText,
    ],
  )

  return (
    <div
      className="rounded-xl p-4 backdrop-blur-md"
      style={{ background: 'var(--ab-badge-bg)', border: '1px solid var(--ab-badge-border)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <h4 className="text-lg font-semibold" style={{ color: 'var(--ab-text)' }}>
          {t('wallet_details.transactions.detail_title', 'Transaction details')}
        </h4>
        <div className="flex items-center gap-2">
          <button
            aria-label={t('wallet_details.actions.support', 'Support')}
            className="p-2 rounded-lg transition-colors"
            onClick={onSupport}
            style={{ background: 'var(--ab-hover)' }}
            type="button"
          >
            <HelpCircle className="w-5 h-5" style={{ color: 'var(--ab-text)' }} />
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            onClick={onBack}
            style={{ background: 'var(--ab-hover)', color: 'var(--ab-text)' }}
            type="button"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('wallet_details.actions.back_to_list', 'Back')}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" style={{ color: 'var(--ab-text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--ab-text-muted)' }}>{t('wallet_details.transactions.date', 'Date')}</span>
          </div>
          <span className="text-sm font-medium" style={{ color: 'var(--ab-text)' }}>{formatDateWithTime(transaction.createdAt)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--ab-text-muted)' }}>{t('wallet_details.transactions.status', 'Status')}</span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${getStatusStyle(transaction.status)}`}>
            {getStatusText(transaction.status)}
          </span>
        </div>

        <div className="rounded-lg p-3" style={{ background: 'var(--ab-hover)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4" style={{ color: 'var(--ab-text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--ab-text-muted)' }}>{t('wallet_details.transactions.to', 'Destination account')}</span>
          </div>
          <span className="font-mono text-sm break-all" style={{ color: 'var(--ab-text)' }}>{transaction.accountNumber}</span>
        </div>

        <div className="flex gap-4">
          <div className="flex-1 rounded-lg p-3" style={{ background: 'var(--ab-hover)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Send className="w-4 h-4" style={{ color: 'var(--ab-text-muted)' }} />
              <span className="text-xs" style={{ color: 'var(--ab-text-muted)' }}>{t('wallet_details.transactions.from_amount', 'Sent')}</span>
            </div>
            <span className="text-lg font-bold" style={{ color: 'var(--ab-text)' }}>
              $
              {' '}
              {transaction.quote.sourceAmount.toFixed(2)}
              {' '}
              USDC
            </span>
          </div>
          <div className="flex-1 rounded-lg p-3" style={{ background: 'var(--ab-hover)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--ab-text-muted)' }}>{t('wallet_details.transactions.to_amount', 'Received')}</div>
            <span className="text-lg font-bold" style={{ color: 'var(--ab-text)' }}>
              {targetSymbol}
              {' '}
              {targetFormatted}
              {' '}
              {transaction.quote.targetCurrency}
            </span>
          </div>
        </div>

        {(transaction as unknown as { transactionReference?: string }).transactionReference && (
          <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--ab-separator)' }}>
            <Hash className="w-4 h-4 shrink-0" style={{ color: 'var(--ab-text-muted)' }} />
            <div>
              <span className="text-xs" style={{ color: 'var(--ab-text-muted)' }}>{t('wallet_details.transactions.reference', 'Reference')}</span>
              <span className="block font-mono text-sm break-all" style={{ color: 'var(--ab-text)' }}>{(transaction as unknown as { transactionReference: string }).transactionReference}</span>
            </div>
          </div>
        )}

        <div className="pt-4" style={{ borderTop: '1px solid var(--ab-separator)' }}>
          <button
            className="flex items-center justify-between w-full py-2 px-3 rounded-lg text-left text-sm font-medium transition-colors"
            onClick={() => setShowFullDetails(v => !v)}
            style={{ background: 'var(--ab-hover)', color: 'var(--ab-text)' }}
            type="button"
          >
            <span>{t('wallet_details.transactions.full_details', 'Full details')}</span>
            {showFullDetails ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
          </button>
          {showFullDetails && (
            <div className="mt-3 rounded-lg overflow-hidden" style={{ background: 'var(--ab-hover)', border: '1px solid var(--ab-separator)' }}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--ab-separator)' }}>
                      <th className="text-left py-3 px-4 font-medium" style={{ color: 'var(--ab-text-muted)' }}>
                        {t('wallet_details.transactions.table.field', 'Field')}
                      </th>
                      <th className="text-left py-3 px-4 font-medium" style={{ color: 'var(--ab-text-muted)' }}>
                        {t('wallet_details.transactions.table.value', 'Value')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map(row => (
                      <tr key={row.label} style={{ borderBottom: '1px solid var(--ab-separator)' }}>
                        <td className="py-3 px-4 align-top whitespace-nowrap" style={{ color: 'var(--ab-text-muted)' }}>{row.label}</td>
                        <td className="py-3 px-4 font-mono break-all" style={{ color: 'var(--ab-text)' }}>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransactionDetail
