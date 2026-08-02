import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  RadioTower,
  RotateCcw,
  UserRoundCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import type { OpsTransactionSummary, TransactionStatus } from '../../../services/admin/transactionAdminTypes'

import {
  formatAmount,
  formatDateTime,
  humanizeStatus,
  OpsStatusBadge,
  OpsTone,
} from '../shared'

const statusTone: Readonly<Record<TransactionStatus, OpsTone>> = {
  AWAITING_PAYMENT: 'warning',
  PAYMENT_COMPLETED: 'success',
  PAYMENT_EXPIRED: 'neutral',
  PAYMENT_FAILED: 'danger',
  PROCESSING_PAYMENT: 'info',
  WRONG_AMOUNT: 'danger',
}

const Signal = ({ children, danger = false, icon }: {
  children: React.ReactNode
  danger?: boolean
  icon: React.ReactNode
}) => (
  <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${danger ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-ops-border bg-white text-ops-muted'}`}>
    {icon}
    {children}
  </span>
)

const shortId = (value: string): string => value.length > 16
  ? `${value.slice(0, 8)}…${value.slice(-5)}`
  : value

const TransactionSummaryCard = ({ transaction }: { transaction: OpsTransactionSummary }) => {
  const slaActive = transaction.sla.state !== 'COMPLETE'
  return (
    <article className="ops-card-interactive group relative overflow-hidden">
      <Link
        aria-label={`Investigate ${transaction.quote.targetAmount} ${transaction.quote.targetCurrency} transaction for ${transaction.partner.name}`}
        className="block p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-brand sm:p-6"
        to={`/ops/transactions/${encodeURIComponent(transaction.id)}`}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <OpsStatusBadge label={humanizeStatus(transaction.status)} tone={statusTone[transaction.status]} />
              <span className="text-xs font-semibold text-ops-muted">
                {transaction.provider.label}
                {' · '}
                {transaction.quote.cryptoCurrency}
                {' on '}
                {humanizeStatus(transaction.quote.network)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-ops-text">
                {formatAmount(transaction.quote.targetAmount)}
                {' '}
                {transaction.quote.targetCurrency}
              </h2>
              <span className="text-sm text-ops-muted">
                from
                {' '}
                {formatAmount(transaction.quote.sourceAmount)}
                {' '}
                {transaction.quote.cryptoCurrency}
              </span>
            </div>
            <p className="mt-2 truncate text-sm font-medium text-ops-text">{transaction.partner.name}</p>
            <p className="mt-1 text-xs text-ops-muted">
              Created
              {' '}
              {formatDateTime(transaction.createdAt)}
              {' · '}
              ID
              {' '}
              <span className="font-mono" title={transaction.id}>{shortId(transaction.id)}</span>
            </p>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4 lg:flex-col lg:items-end">
            {slaActive
              ? (
                  <Signal danger={transaction.sla.state === 'BREACHED'} icon={<Clock3 aria-hidden size={14} />}>
                    {transaction.sla.state === 'BREACHED' ? 'SLA breached' : transaction.sla.state === 'AT_RISK' ? 'SLA at risk' : 'Within SLA'}
                    {' · '}
                    {transaction.sla.ageMinutes}
                    m
                  </Signal>
                )
              : <span className="text-xs text-ops-muted">Terminal state</span>}
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ops-brand">
              Investigate
              <ArrowRight aria-hidden className="transition-transform group-hover:translate-x-0.5" size={16} />
            </span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 border-t border-ops-border pt-4">
          {transaction.attentionReasons.map(reason => (
            <Signal danger icon={<AlertTriangle aria-hidden size={14} />} key={reason}>{humanizeStatus(reason)}</Signal>
          ))}
          <Signal
            danger={transaction.proof.status === 'MISSING'}
            icon={transaction.proof.status === 'AVAILABLE' ? <CheckCircle2 aria-hidden size={14} /> : <FileCheck2 aria-hidden size={14} />}
          >
            Proof
            {' · '}
            {humanizeStatus(transaction.proof.status)}
          </Signal>
          <Signal danger={transaction.webhook.status === 'FAILED'} icon={<RadioTower aria-hidden size={14} />}>
            Webhook
            {' · '}
            {humanizeStatus(transaction.webhook.status)}
          </Signal>
          {transaction.refund.status !== 'NOT_APPLICABLE' && (
            <Signal danger={transaction.refund.status === 'FAILED' || transaction.refund.status === 'NOT_STARTED'} icon={<RotateCcw aria-hidden size={14} />}>
              Refund
              {' · '}
              {humanizeStatus(transaction.refund.status)}
            </Signal>
          )}
          {transaction.case && (
            <Signal icon={<UserRoundCheck aria-hidden size={14} />}>
              Case
              {' · '}
              {transaction.case.owner?.displayName ?? transaction.case.team ?? 'Unassigned'}
            </Signal>
          )}
        </div>
      </Link>
    </article>
  )
}

export default TransactionSummaryCard
