import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LoaderCircle,
  RadioTower,
  WalletCards,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import type {
  PartnerTransactionDelivery,
  PartnerTransactionDetail as PartnerTransactionDetailData,
  PartnerTransactionRefund,
} from '../../services/partnerPortal/partnerPortalTypes'

import { getPartnerTransaction } from '../../services/partnerPortal/partnerPortalApi'
import {
  formatPartnerAmount,
  formatPartnerDateTime,
  partnerStatusMeta,
  shortTransactionId,
} from './partnerPortalPresentation'
import { CopyValueButton, PartnerStatusBadge } from './partnerPortalUi'

const deliveryLabel = (delivery: PartnerTransactionDelivery): string => {
  if (delivery.event === 'transaction.created') return 'Transaction created'
  if (delivery.event === 'transaction.updated') return 'Status update'
  return 'Transaction notification'
}

const deliveryStatus = (delivery: PartnerTransactionDelivery): { className: string, label: string } => {
  if (delivery.status === 'DELIVERED') return { className: 'text-emerald-700', label: 'Delivered' }
  if (delivery.status === 'FAILED') return { className: 'text-rose-700', label: 'Delivery failed' }
  if (delivery.status === 'DELIVERING') return { className: 'text-sky-700', label: 'Delivering' }
  return { className: 'text-amber-700', label: 'Queued' }
}

const refundStatusMeta: Record<PartnerTransactionRefund['status'], { className: string, label: string }> = {
  COMPLETED: { className: 'text-emerald-700', label: 'Refunded' },
  FAILED: { className: 'text-rose-700', label: 'Refund failed' },
  NOT_STARTED: { className: 'text-amber-700', label: 'Not started' },
  PROCESSING: { className: 'text-sky-700', label: 'Refund processing' },
}

const DetailField = ({ children, label }: {
  children: React.ReactNode
  label: string
}) => (
  <div className="min-w-0">
    <dt className="partner-label">{label}</dt>
    <dd className="mt-2 min-w-0 text-sm font-medium text-partner-ink">{children}</dd>
  </div>
)

const CopyableIdentifier = ({ label, value }: { label: string, value: string }) => (
  <span className="flex w-full min-w-0 items-center gap-2">
    <span className="min-w-0 flex-1 truncate font-mono" title={value}>{value}</span>
    <CopyValueButton label={label} value={value} />
  </span>
)

const PartnerTransactionDetail = () => {
  const { transactionId } = useParams()
  const [data, setData] = useState<null | PartnerTransactionDetailData>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!transactionId) {
      setError('Transaction ID is missing')
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void getPartnerTransaction(transactionId, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response)
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Could not load this transaction')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [refreshKey, transactionId])

  if (loading && !data) {
    return (
      <div aria-live="polite" className="partner-empty-state min-h-52">
        <LoaderCircle aria-hidden className="h-5 w-5 animate-spin text-partner-forest motion-reduce:animate-none" />
        <span>Loading transaction…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="partner-empty-state min-h-64 flex-col text-center">
        <CircleDashed aria-hidden className="h-7 w-7 text-partner-forest" />
        <div>
          <h1 className="text-xl font-semibold text-partner-ink">Transaction unavailable</h1>
          <p className="mt-2 text-sm text-partner-muted">{error ?? 'The transaction could not be found.'}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link className="partner-button-secondary" to="/partner/transactions">Back to transactions</Link>
          <button className="partner-button-primary" onClick={() => setRefreshKey(key => key + 1)} type="button">Try again</button>
        </div>
      </div>
    )
  }

  const status = partnerStatusMeta[data.status]
  const refundStatus = data.refund ? refundStatusMeta[data.refund.status] : null

  return (
    <>
      <Link className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-partner-forest hover:text-partner-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest" to="/partner/transactions">
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Back to transactions
      </Link>

      <header className="mt-7 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="partner-eyebrow">
              {`Transaction ${shortTransactionId(data.id)}`}
            </p>
            <PartnerStatusBadge status={data.status} />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-partner-ink sm:text-4xl">
            {formatPartnerAmount(data.quote.targetAmount, data.quote.targetCurrency)}
            {' '}
            payout
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-partner-muted">{status.explanation}</p>
        </div>
        <button className="partner-button-secondary" disabled={loading} onClick={() => setRefreshKey(key => key + 1)} type="button">
          {loading && <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          Refresh
        </button>
      </header>

      <section aria-label="Transaction summary" className="partner-detail-sheet mt-9">
        <div className="grid gap-8 border-b border-partner-border p-6 sm:p-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="partner-label">Financial route</p>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <div>
                <p className="text-2xl font-semibold tracking-[-0.025em] text-partner-ink">
                  {formatPartnerAmount(data.quote.sourceAmount, data.quote.cryptoCurrency)}
                </p>
                <p className="mt-1 text-xs text-partner-muted">
                  {`Received on ${data.quote.network}`}
                </p>
              </div>
              <div aria-hidden className="hidden h-px flex-1 bg-gradient-to-r from-partner-border via-partner-mint to-partner-border sm:block" />
              <div className="sm:text-right">
                <p className="text-2xl font-semibold tracking-[-0.025em] text-partner-forest">
                  {formatPartnerAmount(data.quote.targetAmount, data.quote.targetCurrency)}
                </p>
                <p className="mt-1 text-xs text-partner-muted">
                  {`Payout via ${data.quote.paymentMethod}`}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl bg-partner-ledger p-5">
            <div className="flex items-start gap-3">
              <WalletCards aria-hidden className="mt-0.5 h-5 w-5 text-partner-forest" />
              <div>
                <p className="text-sm font-semibold text-partner-ink">Payout context</p>
                <p className="mt-1 text-xs leading-5 text-partner-muted">
                  {`${data.quote.paymentMethod} · ${data.quote.country}${data.payoutDestinationHint ? ` · Destination ${data.payoutDestinationHint}` : ''}`}
                </p>
              </div>
            </div>
          </div>
        </div>

        <dl className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8 lg:grid-cols-4">
          <DetailField label="Created">{formatPartnerDateTime(data.createdAt)}</DetailField>
          <DetailField label="User reference">{data.userReference}</DetailField>
          <DetailField label="Transaction ID">
            <CopyableIdentifier label="transaction ID" value={data.id} />
          </DetailField>
          <DetailField label="On-chain ID">
            {data.onChainId
              ? <CopyableIdentifier label="on-chain ID" value={data.onChainId} />
              : 'Not available'}
          </DetailField>
          {data.quote.paymentMethod === 'PIX'
            ? (
                <DetailField label="PIX E2E ID">
                  {data.pixEndToEndId
                    ? <CopyableIdentifier label="PIX E2E ID" value={data.pixEndToEndId} />
                    : 'Not available yet'}
                </DetailField>
              )
            : null}
          {data.refund && refundStatus
            ? (
                <>
                  <DetailField label="Refund status">
                    <span className={refundStatus.className}>{refundStatus.label}</span>
                  </DetailField>
                  <DetailField label="Refund on-chain ID">
                    {data.refund.onChainId
                      ? <CopyableIdentifier label="refund on-chain ID" value={data.refund.onChainId} />
                      : 'Not available yet'}
                  </DetailField>
                </>
              )
            : null}
        </dl>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="transaction-lifecycle-title">
          <div className="flex items-center gap-3">
            <Clock3 aria-hidden className="h-5 w-5 text-partner-forest" />
            <div>
              <h2 className="text-lg font-semibold text-partner-ink" id="transaction-lifecycle-title">Lifecycle</h2>
              <p className="mt-0.5 text-xs text-partner-muted">Every recorded status change</p>
            </div>
          </div>
          <ol className="partner-timeline mt-5">
            {data.lifecycle.map((entry, index) => (
              <li className="partner-timeline-item" key={`${entry.occurredAt}-${entry.status}-${index}`}>
                <span aria-hidden className={`partner-timeline-node ${partnerStatusMeta[entry.status].dotClass}`} />
                <div className="pb-7">
                  <p className="text-sm font-semibold text-partner-ink">{partnerStatusMeta[entry.status].label}</p>
                  <p className="mt-1 text-xs text-partner-muted">{formatPartnerDateTime(entry.occurredAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="partner-notifications-title">
          <div className="flex items-center gap-3">
            <RadioTower aria-hidden className="h-5 w-5 text-partner-forest" />
            <div>
              <h2 className="text-lg font-semibold text-partner-ink" id="partner-notifications-title">Partner notifications</h2>
              <p className="mt-0.5 text-xs text-partner-muted">Webhook delivery for this transaction</p>
            </div>
          </div>
          {data.deliveries.length === 0
            ? (
                <div className="partner-notification-row mt-5">
                  <CircleDashed aria-hidden className="h-5 w-5 text-partner-muted" />
                  <div>
                    <p className="text-sm font-semibold text-partner-ink">No delivery record yet</p>
                    <p className="mt-1 text-xs text-partner-muted">Notifications will appear as the transaction progresses.</p>
                  </div>
                </div>
              )
            : (
                <ul className="mt-5 space-y-3">
                  {data.deliveries.map((delivery, index) => {
                    const deliveryMeta = deliveryStatus(delivery)
                    return (
                      <li className="partner-notification-row" key={`${delivery.event}-${delivery.lastAttemptAt}-${index}`}>
                        {delivery.status === 'DELIVERED'
                          ? <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-600" />
                          : <CircleDashed aria-hidden className="h-5 w-5 text-partner-muted" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-partner-ink">{deliveryLabel(delivery)}</p>
                            <span className={`text-xs font-semibold ${deliveryMeta.className}`}>{deliveryMeta.label}</span>
                          </div>
                          <p className="mt-1 text-xs text-partner-muted">
                            {`${formatPartnerDateTime(delivery.lastAttemptAt)} · ${delivery.attempts} attempt${delivery.attempts === 1 ? '' : 's'}`}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
        </section>
      </div>
    </>
  )
}

export default PartnerTransactionDetail
