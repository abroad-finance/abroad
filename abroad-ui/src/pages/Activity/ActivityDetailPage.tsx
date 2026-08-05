import { useTranslate } from '@tolgee/react'
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Share2,
} from 'lucide-react'
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { ActivityPageShell } from '@/features/activity/components/ActivityPageShell'
import { ActivityStatusPill } from '@/features/activity/components/ActivityStatusPill'
import {
  useConsumerActivityDetail,
  useConsumerActivityReceiptDownload,
} from '@/features/activity/hooks/useConsumerActivity'
import {
  activityReferenceRows,
  activityStatusPresentation,
  formatActivityDateTime,
  formatActivityMoney,
  formatActivityRate,
} from '@/features/activity/shared/activityPresentation'
import {
  type ConsumerUxDimensions,
  type ConsumerUxEventName,
  getCheckoutTelemetrySessionKey,
  normalizeConsumerUxRail,
  recordConsumerUxEvent,
} from '@/observability/consumerUxTelemetry'
import { ABROAD_SUPPORT_URL } from '@/shared/constants'
import { cn } from '@/shared/utils'

const currentLocale = (): string => document.documentElement.lang || navigator.language || 'en-US'

const ActivityDetailPage = (): React.JSX.Element => {
  const { t } = useTranslate()
  const { transactionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const activity = useConsumerActivityDetail(transactionId)
  const receiptDownload = useConsumerActivityReceiptDownload(transactionId)
  const [copiedReference, setCopiedReference] = useState<null | string>(null)
  const [copyError, setCopyError] = useState<null | string>(null)
  const [shareError, setShareError] = useState<null | string>(null)
  const [shared, setShared] = useState(false)
  const receiptTelemetrySessionKeyRef = useRef(getCheckoutTelemetrySessionKey())
  const locale = currentLocale()
  const rawReturn = searchParams.get('return')
  const safeReturn = rawReturn?.startsWith('?') && rawReturn.length <= 1_000 ? rawReturn : ''
  const backTarget = `/activity${safeReturn}`
  const translateActivity = useCallback((key: string, fallback: string): string => (
    // @tolgee-ignore
    t(key, fallback)
  ), [t])

  const recordReceiptAction = useCallback((
    name: ConsumerUxEventName,
    dimensions?: ConsumerUxDimensions,
    onceSuffix?: string,
  ): void => {
    const sessionKey = receiptTelemetrySessionKeyRef.current
    if (!sessionKey) return
    recordConsumerUxEvent({
      dimensions: {
        rail: normalizeConsumerUxRail(activity.receipt?.quote.paymentMethod),
        reference_available: Boolean(activity.receipt && activityReferenceRows(activity.receipt).length > 1),
        step: 'receipt',
        ...dimensions,
      },
      name,
      session: { key: sessionKey, kind: 'checkout' },
    }, onceSuffix ? { onceKey: `${sessionKey}:${onceSuffix}` } : undefined)
  }, [activity.receipt])

  useEffect(() => {
    if (!activity.receipt) return
    recordReceiptAction('receipt_viewed', {
      outcome: 'success',
      status: activity.receipt.status === 'PAYMENT_COMPLETED'
        ? 'COMPLETED'
        : activity.receipt.status === 'PAYMENT_FAILED'
          ? 'FAILED'
          : activity.receipt.status === 'PAYMENT_EXPIRED'
            ? 'EXPIRED'
            : activity.receipt.status === 'PROCESSING_PAYMENT'
              ? 'PROCESSING'
              : activity.receipt.status === 'AWAITING_PAYMENT'
                ? 'PENDING'
                : 'UNKNOWN',
    }, 'receipt-viewed')
  }, [activity.receipt, recordReceiptAction])

  const recordDetailAction = (
    name: 'activity_reference_action' | 'activity_retry',
    action: 'copy' | 'download' | 'help' | 'refresh' | 'retry' | 'share',
    outcome?: 'cancelled' | 'error' | 'success',
  ): void => {
    if (!activity.telemetrySessionKey) return
    recordConsumerUxEvent({
      dimensions: {
        action,
        outcome,
        rail: normalizeConsumerUxRail(activity.receipt?.quote.paymentMethod),
        reference_available: Boolean(activity.receipt && activityReferenceRows(activity.receipt).length > 1),
      },
      name,
      session: { key: activity.telemetrySessionKey, kind: 'activity' },
    })
  }

  const copyReference = async (key: string, value: string): Promise<void> => {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(value)
      setCopiedReference(key)
      recordDetailAction('activity_reference_action', 'copy', 'success')
      recordReceiptAction('receipt_reference_copied', { action: 'copy', outcome: 'success' })
      window.setTimeout(() => setCopiedReference(null), 2_000)
    }
    catch {
      setCopyError(t('activity.detail.copy_error', 'Could not copy this reference.'))
      recordDetailAction('activity_reference_action', 'copy', 'error')
      recordReceiptAction('receipt_reference_copied', { action: 'copy', outcome: 'error' })
    }
  }

  const shareReceipt = async (): Promise<void> => {
    setShareError(null)
    const url = `${window.location.origin}/activity/${encodeURIComponent(transactionId)}`
    try {
      if (navigator.share) {
        await navigator.share({
          text: t('activity.detail.share_text', 'Open this payment in Abroad Activity.'),
          title: t('activity.detail.share_title', 'Abroad payment'),
          url,
        })
      }
      else {
        await navigator.clipboard.writeText(url)
      }
      setShared(true)
      recordDetailAction('activity_reference_action', 'share', 'success')
      recordReceiptAction('receipt_shared', { action: 'share', outcome: 'success' })
      window.setTimeout(() => setShared(false), 2_000)
    }
    catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        recordDetailAction('activity_reference_action', 'share', 'cancelled')
        recordReceiptAction('receipt_shared', { action: 'share', outcome: 'cancelled' })
        return
      }
      setShareError(t('activity.detail.share_error', 'Could not share this payment link.'))
      recordDetailAction('activity_reference_action', 'share', 'error')
      recordReceiptAction('receipt_shared', { action: 'share', outcome: 'error' })
    }
  }

  return (
    <ActivityPageShell>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <Link className="mb-6 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[var(--ab-text-secondary)] hover:bg-[var(--ab-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]" onClick={() => recordReceiptAction('history_opened_from_receipt', { action: 'view_activity' })} to={backTarget}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t('activity.detail.back', 'Back to Activity')}
        </Link>

        {activity.status === 'unauthenticated' && (
          <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-6 py-12 text-center shadow-sm">
            <h1 className="text-2xl font-bold">{t('activity.auth.title', 'Connect your wallet to view Activity')}</h1>
            <p className="mt-2 text-sm text-[var(--ab-text-muted)]">{t('activity.detail.auth_body', 'This receipt is available only to the wallet that created the payment.')}</p>
            <Link className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--ab-green)] px-5 text-sm font-bold text-white" to="/">{t('activity.auth.action', 'Go to payment')}</Link>
          </section>
        )}

        {activity.status === 'loading' && (
          <div aria-live="polite" className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-10 text-center text-sm text-[var(--ab-text-muted)]" role="status">
            {t('activity.detail.loading', 'Loading payment details…')}
          </div>
        )}

        {(activity.status === 'error' || (activity.status === 'offline' && !activity.receipt)) && (
          <section className="rounded-3xl border border-red-200 bg-red-50 px-6 py-8 text-red-900" role="alert">
            <h1 className="text-xl font-bold">{t('activity.detail.error_title', 'Payment details unavailable')}</h1>
            <p className="mt-2 text-sm">{activity.error ?? t('activity.detail.error_body', 'We could not load this Activity item.')}</p>
            {activity.status === 'offline' && <p className="mt-2 text-sm">{t('activity.error.offline', 'You appear to be offline. Reconnect and try again.')}</p>}
            <button
              className="mt-5 min-h-11 rounded-xl border border-current px-4 text-sm font-bold"
              onClick={() => {
                recordDetailAction('activity_retry', 'retry')
                void activity.refresh()
              }}
              type="button"
            >
              {t('activity.error.retry', 'Try again')}
            </button>
          </section>
        )}

        {activity.receipt && (() => {
          const receipt = activity.receipt
          const presentation = activityStatusPresentation(receipt.status, translateActivity)
          const targetAmount = formatActivityMoney(receipt.quote.targetAmount, receipt.quote.targetCurrency, locale)
          const sourceAmount = formatActivityMoney(receipt.quote.sourceAmount, receipt.quote.sourceCurrency, locale)
          const rate = formatActivityRate(receipt.effectiveRate, receipt.quote.sourceCurrency, receipt.quote.targetCurrency, locale)
          const references = activityReferenceRows(receipt, translateActivity)
          const numericFee = receipt.fee ? Number(receipt.fee.amount) : null
          const feeDisplay = receipt.fee && numericFee !== null && Number.isFinite(numericFee) && numericFee >= 0
            ? formatActivityMoney(numericFee, receipt.fee.currency, locale)
            : null
          const feeType = receipt.fee?.type === 'COMBINED'
            ? t('activity.detail.fee_type.combined', 'Combined fee')
            : receipt.fee?.type === 'FIXED'
              ? t('activity.detail.fee_type.fixed', 'Fixed fee')
              : receipt.fee?.type === 'PERCENTAGE'
                ? t('activity.detail.fee_type.percentage', 'Percentage fee')
                : receipt.fee?.type === 'NETWORK'
                  ? t('activity.detail.fee_type.network', 'Network fee')
                  : receipt.fee?.type === 'NONE'
                    ? t('activity.detail.fee_type.none', 'No fee')
                    : null
          const refundStatus = receipt.refund.status === 'COMPLETED'
            ? t('activity.detail.refund.completed', 'Refund completed')
            : receipt.refund.status === 'FAILED'
              ? t('activity.detail.refund.failed', 'Refund failed')
              : receipt.refund.status === 'PROCESSING'
                ? t('activity.detail.refund.processing', 'Refund processing')
                : receipt.refund.status === 'NOT_STARTED'
                  ? t('activity.detail.refund.not_started', 'Refund not started')
                  : receipt.refund.status === 'UNKNOWN'
                    ? t('activity.detail.refund.unknown', 'Refund status needs review')
                    : t('activity.detail.refund.not_applicable', 'Not applicable')
          return (
            <article className="space-y-5">
              {(activity.status === 'stale' || activity.status === 'offline') && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
                  <p className="font-semibold">{activity.error ?? t('activity.error.stale', 'Showing the last successfully loaded details.')}</p>
                  {activity.status === 'offline' && <p className="mt-1">{t('activity.error.offline', 'You appear to be offline. Showing the last loaded details.')}</p>}
                  <button
                    className="mt-2 min-h-11 rounded-xl border border-current px-4 font-bold"
                    onClick={() => {
                      recordDetailAction('activity_retry', 'retry')
                      void activity.refresh()
                    }}
                    type="button"
                  >
                    {t('activity.error.retry', 'Try again')}
                  </button>
                </div>
              )}

              <section className="overflow-hidden rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] shadow-sm">
                <div className="border-b border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-5 py-6 sm:px-8 sm:py-8">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <ActivityStatusPill label={presentation.label} tone={presentation.tone} />
                      <h1 className="font-cereal mt-4 text-3xl font-bold tracking-tight">{presentation.label}</h1>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ab-text-muted)]">{presentation.description}</p>
                    </div>
                    <button
                      aria-label={t('activity.detail.refresh', 'Refresh payment details')}
                      className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 text-sm font-semibold disabled:opacity-60"
                      disabled={activity.isRefreshing}
                      onClick={() => {
                        recordDetailAction('activity_retry', 'refresh')
                        void activity.refresh()
                      }}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" className={cn('h-4 w-4', activity.isRefreshing && 'animate-spin motion-reduce:animate-none')} />
                      {activity.isRefreshing ? t('activity.refreshing', 'Refreshing…') : t('activity.refresh', 'Refresh')}
                    </button>
                  </div>
                </div>

                <div className="grid gap-px bg-[var(--ab-border)] sm:grid-cols-2">
                  <div className="bg-[var(--ab-card)] px-5 py-6 sm:px-8">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.detail.source_amount', 'You sent')}</p>
                    <p className="font-cereal mt-2 text-2xl font-bold tabular-nums">{sourceAmount}</p>
                    <p className="mt-1 text-sm text-[var(--ab-text-muted)]">{receipt.quote.network}</p>
                  </div>
                  <div className="bg-[var(--ab-card)] px-5 py-6 sm:px-8">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.detail.target_amount', 'Recipient amount')}</p>
                    <p className="font-cereal mt-2 text-2xl font-bold tabular-nums">{targetAmount}</p>
                    <p className="mt-1 text-sm text-[var(--ab-text-muted)]">
                      {receipt.quote.paymentMethod === 'BREB' ? 'BRE-B' : receipt.quote.paymentMethod}
                      {' '}
                      ·
                      {' '}
                      {receipt.recipientHint ?? t('activity.recipient.unavailable', 'Recipient unavailable')}
                    </p>
                  </div>
                </div>
              </section>

              <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-bold">{t('activity.detail.payment_details', 'Payment details')}</h2>
                  <dl className="mt-4 divide-y divide-[var(--ab-border)]">
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.rail', 'Payment rail')}</dt>
                      <dd className="text-right text-sm font-semibold">{receipt.quote.paymentMethod === 'BREB' ? 'BRE-B' : receipt.quote.paymentMethod}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.network', 'Network')}</dt>
                      <dd className="text-right text-sm font-semibold">{receipt.quote.network}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.fee', 'Fee')}</dt>
                      <dd className="text-right text-sm font-semibold">
                        {feeDisplay && feeType
                          ? `${feeDisplay} · ${feeType}`
                          : t('activity.detail.fee_unavailable', 'Fee unavailable')}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.rate', 'Effective rate')}</dt>
                      <dd className="max-w-[60%] text-right text-sm font-semibold">{rate ?? t('activity.detail.unavailable', 'Unavailable')}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.accepted_at', 'Accepted')}</dt>
                      <dd className="max-w-[60%] text-right text-sm font-semibold">{formatActivityDateTime(receipt.timestamps.acceptedAt, locale, t('activity.detail.unavailable', 'Unavailable'))}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.updated_at', 'Last updated')}</dt>
                      <dd className="max-w-[60%] text-right text-sm font-semibold">{formatActivityDateTime(receipt.timestamps.updatedAt, locale, t('activity.detail.unavailable', 'Unavailable'))}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.reconciled_at', 'Last reconciled')}</dt>
                      <dd className="max-w-[60%] text-right text-sm font-semibold">{receipt.timestamps.lastReconciledAt ? formatActivityDateTime(receipt.timestamps.lastReconciledAt, locale, t('activity.detail.unavailable', 'Unavailable')) : t('activity.detail.unavailable', 'Unavailable')}</dd>
                    </div>
                    <div className="flex justify-between gap-4 py-3">
                      <dt className="text-sm text-[var(--ab-text-muted)]">{t('activity.detail.completed_at', 'Completed')}</dt>
                      <dd className="max-w-[60%] text-right text-sm font-semibold">{receipt.timestamps.completedAt ? formatActivityDateTime(receipt.timestamps.completedAt, locale, t('activity.detail.unavailable', 'Unavailable')) : t('activity.detail.not_completed', 'Not completed')}</dd>
                    </div>
                  </dl>
                </section>

                <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-bold">{t('activity.detail.references', 'References')}</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--ab-text-muted)]">{t('activity.detail.references_help', 'Use the Abroad ID when contacting support. Other references appear only when recorded.')}</p>
                  <div className="mt-4 space-y-3">
                    {references.map(reference => (
                      <div className="rounded-2xl bg-[var(--ab-bg-subtle)] p-3" key={reference.key}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-[var(--ab-text-muted)]">{reference.label}</span>
                          <button aria-label={`${t('activity.detail.copy', 'Copy')} ${reference.label}`} className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--ab-text-secondary)] hover:bg-[var(--ab-card)]" onClick={() => void copyReference(reference.key, reference.value)} type="button">
                            {copiedReference === reference.key ? <Check aria-hidden="true" className="h-4 w-4 text-[var(--ab-green)]" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                          </button>
                        </div>
                        <p className="break-all font-mono text-xs leading-5 text-[var(--ab-text-secondary)]">{reference.value}</p>
                      </div>
                    ))}
                  </div>
                  {copyError && <p className="mt-3 text-sm text-red-700" role="alert">{copyError}</p>}
                </section>
              </div>

              <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 shadow-sm sm:p-6">
                <h2 className="text-lg font-bold">{t('activity.detail.proof_refund', 'Proof and refund')}</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-[var(--ab-bg-subtle)] p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.detail.proof', 'Payment proof')}</p>
                    <p className="mt-2 text-sm font-semibold">{receipt.proof.status === 'AVAILABLE' ? t('activity.detail.proof_available', 'Proof available') : receipt.proof.status === 'PENDING' ? t('activity.detail.proof_pending', 'Proof pending') : receipt.proof.status === 'MISSING' ? t('activity.detail.proof_missing', 'Proof not recorded') : t('activity.detail.proof_not_applicable', 'Not applicable')}</p>
                    {receipt.proof.receiptAvailable && (
                      <button
                        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={receiptDownload.isDownloading}
                        onClick={() => {
                          void receiptDownload.download(locale.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en')
                            .then((downloaded) => {
                              recordDetailAction('activity_reference_action', 'download', downloaded ? 'success' : 'error')
                              recordReceiptAction('receipt_downloaded', {
                                action: 'download',
                                outcome: downloaded ? 'success' : 'error',
                              })
                            })
                        }}
                        type="button"
                      >
                        <Download aria-hidden="true" className="h-4 w-4" />
                        {receiptDownload.isDownloading
                          ? t('activity.detail.receipt_downloading', 'Downloading receipt…')
                          : t('activity.detail.receipt_download', 'Download receipt')}
                      </button>
                    )}
                    {receiptDownload.error && <p className="mt-2 text-sm text-red-700" role="alert">{receiptDownload.error}</p>}
                  </div>
                  <div className="rounded-2xl bg-[var(--ab-bg-subtle)] p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.detail.refund', 'Refund')}</p>
                    <p className="mt-2 text-sm font-semibold">{refundStatus}</p>
                  </div>
                </div>
              </section>

              {(shareError || shared) && (
                <p aria-live="polite" className={cn('text-sm', shareError ? 'text-red-700' : 'text-[var(--ab-green)]')} role={shareError ? 'alert' : 'status'}>
                  {shareError ?? t('activity.detail.share_success', 'Payment link ready to share.')}
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 text-sm font-semibold" onClick={() => void shareReceipt()} type="button">
                    <Share2 aria-hidden="true" className="h-4 w-4" />
                    {t('activity.detail.share', 'Share payment')}
                  </button>
                  <a
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 text-sm font-semibold"
                    href={ABROAD_SUPPORT_URL}
                    onClick={() => {
                      recordDetailAction('activity_reference_action', 'help')
                      recordReceiptAction('support_opened_from_receipt', { action: 'help' })
                    }}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t('activity.detail.support', 'Get support')}
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </a>
                </div>
                <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--ab-green)] px-5 text-sm font-bold text-white" to="/">{t('activity.navigation.new_payment', 'New payment')}</Link>
              </div>
            </article>
          )
        })()}
      </main>
    </ActivityPageShell>
  )
}

export default ActivityDetailPage
