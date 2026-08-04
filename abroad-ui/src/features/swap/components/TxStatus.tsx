import { useTranslate } from '@tolgee/react'
import {
  Check,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import React, {
  memo, useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'

import type { PaymentAuthorizationState } from '@/features/swap/model/paymentIntent'

import { ActivityStatusPill } from '@/features/activity/components/ActivityStatusPill'
import { useConsumerActivityDetail } from '@/features/activity/hooks/useConsumerActivity'
import {
  activityStatusPresentation,
  formatActivityDateTime,
  formatActivityMoney,
} from '@/features/activity/shared/activityPresentation'
import { canRetryWalletAuthorization } from '@/features/swap/model/paymentIntent'
import {
  bucketElapsedMilliseconds,
  type ConsumerUxDimensions,
  type ConsumerUxEventName,
  getCheckoutTelemetrySessionKey,
  normalizeConsumerUxRail,
  recordConsumerUxEvent,
} from '@/observability/consumerUxTelemetry'
import { ABROAD_SUPPORT_URL } from '@/shared/constants'
import { cn } from '@/shared/utils'

type ProgressStep = {
  label: string
  state: ProgressStepState
}

type ProgressStepState = 'current' | 'done' | 'pending' | 'problem'
type Translate = (key: string, fallback: string) => string

interface TxStatusProps {
  authorizationState: null | PaymentAuthorizationState
  onNewTransaction: () => void
  onResumeAuthorization: () => Promise<void>
  transactionId: null | string
}

const isTerminalStatus = (status: null | string): boolean => (
  status === 'PAYMENT_COMPLETED'
  || status === 'PAYMENT_EXPIRED'
  || status === 'PAYMENT_FAILED'
  || status === 'WRONG_AMOUNT'
)

const telemetryStatus = (
  status: null | string,
): NonNullable<ConsumerUxDimensions['status']> => {
  switch (status) {
    case 'AWAITING_PAYMENT': return 'PENDING'
    case null: return 'UNKNOWN'
    case 'PAYMENT_COMPLETED': return 'COMPLETED'
    case 'PAYMENT_EXPIRED': return 'EXPIRED'
    case 'PAYMENT_FAILED': return 'FAILED'
    case 'PROCESSING_PAYMENT': return 'PROCESSING'
    default: return 'UNKNOWN'
  }
}

const telemetryTerminalOutcome = (
  status: null | string,
): ConsumerUxDimensions['terminal_outcome'] => {
  switch (status) {
    case null: return undefined
    case 'PAYMENT_COMPLETED': return 'completed'
    case 'PAYMENT_EXPIRED': return 'expired'
    case 'PAYMENT_FAILED': return 'failed'
    case 'WRONG_AMOUNT': return 'manual_review'
    default: return undefined
  }
}

const localAuthorizationMessage = (
  authorization: null | PaymentAuthorizationState,
  translate: Translate,
): null | { body: string, title: string, tone: 'attention' | 'neutral' } => {
  switch (authorization?.kind) {
    case 'accepted':
      return {
        body: translate('tx_status.authorization.accepted.body', 'Your Abroad request is saved. Resume the wallet authorization for this same request.'),
        title: translate('tx_status.authorization.accepted.title', 'Payment request created'),
        tone: 'neutral',
      }
    case 'authorizing':
      return {
        body: translate('tx_status.authorization.authorizing.body', 'Review the exact amount and network in your wallet. Closing the wallet does not create another Abroad request.'),
        title: translate('tx_status.authorization.authorizing.title', 'Waiting for wallet authorization'),
        tone: 'neutral',
      }
    case 'broadcast-confirmed':
      return {
        body: translate('tx_status.authorization.confirmed.body', 'The wallet returned an on-chain reference. Abroad is confirming the transfer and local payout.'),
        title: translate('tx_status.authorization.confirmed.title', 'Transfer submitted'),
        tone: 'neutral',
      }
    case 'broadcast-unknown':
      return {
        body: translate('tx_status.authorization.unknown.body', 'The transfer may have been submitted. Do not send it again while Abroad reconciles the network and payment state.'),
        title: translate('tx_status.authorization.unknown.title', 'Transfer outcome is being checked'),
        tone: 'attention',
      }
    case 'wallet-rejected':
      return {
        body: translate('tx_status.authorization.rejected.body', 'No funding proof was received. Your Abroad request is saved, so you can resume without creating a duplicate.'),
        title: translate('tx_status.authorization.rejected.title', 'Wallet authorization cancelled'),
        tone: 'attention',
      }
    case undefined:
    default:
      return null
  }
}

const progressSteps = (
  authorization: null | PaymentAuthorizationState,
  status: null | string,
  translate: Translate,
): ProgressStep[] => {
  const broadcastKnown = authorization?.kind === 'broadcast-confirmed'
    || status === 'PROCESSING_PAYMENT'
    || status === 'PAYMENT_COMPLETED'
  const walletProblem = authorization?.kind === 'wallet-rejected'
  const broadcastUnknown = authorization?.kind === 'broadcast-unknown'
  const localPayoutDone = status === 'PAYMENT_COMPLETED'
  const localPayoutProblem = status === 'PAYMENT_FAILED'
    || status === 'PAYMENT_EXPIRED'
    || status === 'WRONG_AMOUNT'

  return [
    { label: translate('tx_status.step.request', 'Payment request created'), state: 'done' },
    {
      label: translate('tx_status.step.authorization', 'Wallet authorization'),
      state: walletProblem
        ? 'problem'
        : authorization?.kind === 'accepted'
          ? 'current'
          : authorization
            ? 'done'
            : 'pending',
    },
    {
      label: translate('tx_status.step.transfer', 'Stablecoin transfer confirmation'),
      state: broadcastUnknown
        ? 'problem'
        : broadcastKnown
          ? 'done'
          : walletProblem || authorization?.kind === 'accepted'
            ? 'pending'
            : 'current',
    },
    {
      label: translate('tx_status.step.payout', 'Local payout'),
      state: localPayoutDone
        ? 'done'
        : localPayoutProblem
          ? 'problem'
          : status === 'PROCESSING_PAYMENT'
            ? 'current'
            : 'pending',
    },
  ]
}

const StepIcon = ({ state }: { state: ProgressStepState }): React.JSX.Element => {
  if (state === 'done') {
    return <Check aria-hidden="true" className="h-5 w-5 text-[var(--ab-green)]" />
  }
  if (state === 'problem') {
    return <CircleAlert aria-hidden="true" className="h-5 w-5 text-amber-700" />
  }
  if (state === 'current') {
    return <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-[var(--ab-green)] motion-reduce:animate-none" />
  }
  return <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-[var(--ab-border)]" />
}

const TxStatus = ({
  authorizationState,
  onNewTransaction,
  onResumeAuthorization,
  transactionId,
}: Readonly<TxStatusProps>): React.JSX.Element => {
  const { t } = useTranslate()
  const activity = useConsumerActivityDetail(transactionId ?? '')
  const [copyState, setCopyState] = useState<'copied' | 'error' | 'idle'>('idle')
  const [now, setNow] = useState(() => Date.now())
  const telemetrySessionKeyRef = useRef(getCheckoutTelemetrySessionKey())
  const crossedDelayBucketsRef = useRef(new Set<string>())
  const pageExitRecordedRef = useRef(false)
  const receipt = activity.receipt
  const locale = document.documentElement.lang || navigator.language || 'en-US'
  const acceptedAt = receipt ? new Date(receipt.timestamps.acceptedAt).getTime() : null
  const nonterminal = !isTerminalStatus(receipt?.status ?? null)
  const isDelayed = acceptedAt !== null
    && Number.isFinite(acceptedAt)
    && nonterminal
    && now - acceptedAt >= 180_000
  const presentation = receipt
    ? activityStatusPresentation(receipt.status, (key, fallback) => t(key, fallback))
    : null
  const translate = useCallback((key: string, fallback: string): string => t(key, fallback), [t])
  const authorizationMessage = localAuthorizationMessage(authorizationState, translate)
  const steps = useMemo(
    () => progressSteps(authorizationState, receipt?.status ?? null, translate),
    [
      authorizationState,
      receipt?.status,
      translate,
    ],
  )
  const canResume = Boolean(
    authorizationState && canRetryWalletAuthorization(authorizationState),
  )
  const recordProgressEvent = useCallback((
    name: ConsumerUxEventName,
    dimensions?: ConsumerUxDimensions,
    onceSuffix?: string,
  ): void => {
    const sessionKey = telemetrySessionKeyRef.current
    if (!sessionKey) return
    recordConsumerUxEvent({
      dimensions: {
        rail: normalizeConsumerUxRail(receipt?.quote.paymentMethod),
        status: telemetryStatus(receipt?.status ?? null),
        step: 'progress',
        ...dimensions,
      },
      name,
      session: { key: sessionKey, kind: 'checkout' },
    }, onceSuffix ? { onceKey: `${sessionKey}:${onceSuffix}` } : undefined)
  }, [receipt?.quote.paymentMethod, receipt?.status])

  useEffect(() => {
    if (!nonterminal) return
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [nonterminal])

  useEffect(() => {
    crossedDelayBucketsRef.current.clear()
    pageExitRecordedRef.current = false
  }, [transactionId])

  useEffect(() => {
    if (!transactionId) return
    recordProgressEvent('processing_state_viewed', {
      copy_variant: isDelayed ? 'delayed' : 'standard',
      terminal_outcome: telemetryTerminalOutcome(receipt?.status ?? null),
    }, `processing-view:${telemetryStatus(receipt?.status ?? null)}:${isDelayed ? 'delayed' : 'standard'}`)
  }, [
    isDelayed,
    receipt?.status,
    recordProgressEvent,
    transactionId,
  ])

  useEffect(() => {
    if (!transactionId || acceptedAt === null || !Number.isFinite(acceptedAt) || !nonterminal) return
    const elapsed = now - acceptedAt
    const thresholds = [
      30_000,
      60_000,
      120_000,
      180_000,
    ] as const
    thresholds.forEach((threshold) => {
      const key = String(threshold)
      if (elapsed < threshold || crossedDelayBucketsRef.current.has(key)) return
      crossedDelayBucketsRef.current.add(key)
      recordProgressEvent('processing_delay_bucket_crossed', {
        copy_variant: threshold >= 180_000 ? 'delayed' : 'standard',
        elapsed_bucket: bucketElapsedMilliseconds(threshold),
      })
    })
  }, [
    acceptedAt,
    nonterminal,
    now,
    recordProgressEvent,
    transactionId,
  ])

  useEffect(() => {
    if (!transactionId || !nonterminal) return
    const recordPageExit = (): void => {
      if (pageExitRecordedRef.current) return
      pageExitRecordedRef.current = true
      recordProgressEvent('processing_exit', {
        action: 'close',
        elapsed_bucket: acceptedAt === null
          ? 'unknown'
          : bucketElapsedMilliseconds(Date.now() - acceptedAt),
      })
    }
    window.addEventListener('pagehide', recordPageExit)
    return () => window.removeEventListener('pagehide', recordPageExit)
  }, [
    acceptedAt,
    nonterminal,
    recordProgressEvent,
    transactionId,
  ])

  const copyAbroadId = async (): Promise<void> => {
    if (!transactionId) return
    try {
      await navigator.clipboard.writeText(transactionId)
      setCopyState('copied')
      if (completed) {
        recordProgressEvent('receipt_reference_copied', {
          action: 'copy',
          outcome: 'success',
          reference_available: true,
          step: 'receipt',
        })
      }
      window.setTimeout(() => setCopyState('idle'), 2_000)
    }
    catch {
      setCopyState('error')
      if (completed) {
        recordProgressEvent('receipt_reference_copied', {
          action: 'copy',
          outcome: 'error',
          reference_available: true,
          step: 'receipt',
        })
      }
    }
  }

  if (!transactionId) {
    return (
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-red-200 bg-red-50 p-6 text-red-900" role="alert">
        <h1 className="text-xl font-bold">{t('tx_status.missing_id', 'Payment request unavailable')}</h1>
        <p className="mt-2 text-sm">{t('tx_status.missing_id_body', 'No Abroad ID was recorded, so no payment completion is being claimed.')}</p>
        <button className="mt-5 min-h-11 rounded-xl border border-current px-4 text-sm font-bold" onClick={onNewTransaction} type="button">
          {t('tx_status.action.return', 'Return to payment')}
        </button>
      </section>
    )
  }

  const completed = receipt?.status === 'PAYMENT_COMPLETED'
  const terminal = isTerminalStatus(receipt?.status ?? null)
  const heading = completed
    ? t('tx_status.completed', 'Payment completed')
    : terminal
      ? presentation?.label ?? t('tx_status.tracking', 'Tracking payment')
      : authorizationMessage?.title
        ?? (isDelayed
          ? t('tx_status.delayed', 'Still being checked')
          : presentation?.label ?? t('tx_status.tracking', 'Tracking payment'))
  const body = completed
    ? t('tx_status.completed_body', 'The local payout is confirmed. Open the receipt for its authoritative references and proof status.')
    : terminal
      ? presentation?.description ?? t('tx_status.tracking_body', 'Abroad is loading the latest authoritative payment state.')
      : authorizationMessage?.body
        ?? (isDelayed
          ? t('tx_status.delayed_body', 'This payment is still active. Do not submit it again; you can leave this page and continue tracking it in Activity.')
          : presentation?.description ?? t('tx_status.tracking_body', 'Abroad is loading the latest authoritative payment state.'))

  return (
    <article aria-busy={activity.isRefreshing} aria-live="polite" className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-4">
      <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {presentation && <ActivityStatusPill label={presentation.label} tone={presentation.tone} />}
            <h1 className="mt-3 text-2xl font-bold text-[var(--ab-text)] sm:text-3xl">
              {heading}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ab-text-muted)]">
              {body}
            </p>
          </div>
          <button
            aria-label={t('tx_status.refresh', 'Check payment status again')}
            className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-[var(--ab-border)] px-4 text-sm font-semibold disabled:opacity-60"
            disabled={activity.isRefreshing}
            onClick={() => void activity.refresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={cn('h-4 w-4', activity.isRefreshing && 'animate-spin motion-reduce:animate-none')} />
            {activity.isRefreshing ? t('activity.refreshing', 'Refreshing…') : t('tx_status.check_again', 'Check again')}
          </button>
        </div>

        <div className="mt-6 rounded-2xl bg-[var(--ab-bg-subtle)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.reference.abroad', 'Abroad ID')}</p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--ab-text-secondary)]">{transactionId}</p>
            </div>
            <button aria-label={t('tx_status.copy_id', 'Copy Abroad ID')} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--ab-card)]" onClick={() => void copyAbroadId()} type="button">
              {copyState === 'copied' ? <Check aria-hidden="true" className="h-4 w-4 text-[var(--ab-green)]" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
            </button>
          </div>
          {copyState === 'error' && <p className="mt-2 text-sm text-red-700" role="alert">{t('tx_status.copy_failed', 'Could not copy the Abroad ID. You can select it manually.')}</p>}
        </div>

        {receipt && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--ab-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.detail.source_amount', 'You sent')}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatActivityMoney(receipt.quote.sourceAmount, receipt.quote.sourceCurrency, locale)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--ab-border)] p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{t('activity.detail.target_amount', 'Recipient amount')}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{formatActivityMoney(receipt.quote.targetAmount, receipt.quote.targetCurrency, locale)}</p>
            </div>
          </div>
        )}

        <ol aria-label={t('tx_status.progress', 'Payment progress')} className="mt-6 space-y-3">
          {steps.map(step => (
            <li className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--ab-border)] px-4" key={step.label}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center"><StepIcon state={step.state} /></span>
              <span className={cn('text-sm font-semibold', step.state === 'pending' && 'text-[var(--ab-text-muted)]')}>{step.label}</span>
              <span className="sr-only">
                {step.state === 'done'
                  ? t('tx_status.step_state.done', 'Completed')
                  : step.state === 'current'
                    ? t('tx_status.step_state.current', 'Current step')
                    : step.state === 'problem'
                      ? t('tx_status.step_state.problem', 'Needs attention')
                      : t('tx_status.step_state.pending', 'Pending')}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--ab-text-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 aria-hidden="true" className="h-4 w-4" />
            {t('tx_status.safe_leave', 'You may leave this page. Activity will keep the payment available.')}
          </span>
          {activity.lastUpdatedAt && (
            <span>
              {t('tx_status.last_checked', 'Last checked')}
              :
              {' '}
              {formatActivityDateTime(activity.lastUpdatedAt.toISOString(), locale, t('activity.detail.unavailable', 'Unavailable'))}
            </span>
          )}
        </div>

        {(activity.status === 'error' || activity.status === 'stale') && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            {activity.error ?? t('tx_status.status_unavailable', 'The latest status is unavailable. The Abroad ID remains saved.')}
          </p>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {canResume && (
          <button className="min-h-11 rounded-xl bg-[var(--ab-green)] px-5 text-sm font-bold text-white disabled:opacity-60" disabled={activity.isRefreshing} onClick={() => void onResumeAuthorization()} type="button">
            {t('tx_status.resume_authorization', 'Resume wallet authorization')}
          </button>
        )}
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-5 text-sm font-bold"
          onClick={() => recordProgressEvent('processing_exit', {
            action: 'view_activity',
            elapsed_bucket: acceptedAt === null ? 'unknown' : bucketElapsedMilliseconds(now - acceptedAt),
            terminal_outcome: telemetryTerminalOutcome(receipt?.status ?? null),
          })}
          to={`/activity/${encodeURIComponent(transactionId)}`}
        >
          {completed ? t('tx_status.view_receipt', 'View receipt') : t('tx_status.view_activity', 'View in Activity')}
        </Link>
        <a
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-5 text-sm font-bold"
          href={ABROAD_SUPPORT_URL}
          onClick={() => recordProgressEvent('help_opened', {
            action: 'help',
            copy_variant: isDelayed ? 'delayed' : 'standard',
            elapsed_bucket: acceptedAt === null ? 'unknown' : bucketElapsedMilliseconds(now - acceptedAt),
            terminal_outcome: telemetryTerminalOutcome(receipt?.status ?? null),
          })}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('tx_status.support', 'Contact support')}
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </a>
        {terminal && (
          <button
            className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-5 text-sm font-bold"
            onClick={() => {
              recordProgressEvent('processing_exit', {
                action: 'new_payment',
                elapsed_bucket: acceptedAt === null ? 'unknown' : bucketElapsedMilliseconds(now - acceptedAt),
                terminal_outcome: telemetryTerminalOutcome(receipt?.status ?? null),
              })
              onNewTransaction()
            }}
            type="button"
          >
            {t('tx_status.new_payment', 'New payment')}
          </button>
        )}
      </div>
    </article>
  )
}

export default memo(TxStatus)
