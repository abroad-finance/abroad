import { useTranslate } from '@tolgee/react'
import {
  ChevronRight,
  Filter,
  RefreshCw,
  WalletCards,
} from 'lucide-react'
import React, { useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type {
  _36EnumsBlockchainNetwork,
  _36EnumsPaymentMethod,
  _36EnumsTransactionStatus,
  ConsumerActivitySort,
  ListConsumerActivityParams,
} from '@/api'

import { ActivityPageShell } from '@/features/activity/components/ActivityPageShell'
import { ActivityStatusPill } from '@/features/activity/components/ActivityStatusPill'
import { useConsumerActivityList } from '@/features/activity/hooks/useConsumerActivity'
import {
  activityStatusPresentation,
  formatActivityDateTime,
  formatActivityMoney,
} from '@/features/activity/shared/activityPresentation'
import { normalizeConsumerUxRail, recordConsumerUxEvent } from '@/observability/consumerUxTelemetry'
import { cn } from '@/shared/utils'

const PAGE_SIZE = 50
const MAX_ACTIVITY_PAGES = 10
const transactionStatuses: readonly _36EnumsTransactionStatus[] = [
  'AWAITING_PAYMENT',
  'PROCESSING_PAYMENT',
  'PAYMENT_COMPLETED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'WRONG_AMOUNT',
]
const paymentMethods: readonly _36EnumsPaymentMethod[] = ['PIX', 'BREB']
const networks: readonly _36EnumsBlockchainNetwork[] = [
  'STELLAR',
  'SOLANA',
  'CELO',
]
const sortOptions: readonly ConsumerActivitySort[] = ['newest', 'oldest']

const readAllowed = <T extends string>(value: null | string, allowed: readonly T[]): T | undefined => (
  value && allowed.includes(value as T) ? value as T : undefined
)

const readPage = (value: null | string): number => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_ACTIVITY_PAGES)
    : 1
}

const currentLocale = (): string => document.documentElement.lang || navigator.language || 'en-US'

const ActivityListPage = (): React.JSX.Element => {
  const { t } = useTranslate()
  // @tolgee-ignore
  const translateActivity = (key: string, fallback: string): string => t(key, fallback)
  const [searchParams, setSearchParams] = useSearchParams()
  const page = readPage(searchParams.get('page'))
  const status = readAllowed(searchParams.get('status'), transactionStatuses)
  const paymentMethod = readAllowed(searchParams.get('rail'), paymentMethods)
  const network = readAllowed(searchParams.get('network'), networks)
  const sort = readAllowed(searchParams.get('sort'), sortOptions) ?? 'newest'
  const createdFrom = searchParams.get('from') || undefined
  const createdTo = searchParams.get('to') || undefined
  const filters = useMemo<ListConsumerActivityParams>(() => ({
    createdFrom,
    createdTo,
    network,
    page,
    pageSize: PAGE_SIZE,
    paymentMethod,
    sort,
    status,
  }), [
    createdFrom,
    createdTo,
    network,
    page,
    paymentMethod,
    sort,
    status,
  ])
  const activity = useConsumerActivityList(filters, { accumulatePages: true })
  const locale = currentLocale()
  const hasFilters = Boolean(status || paymentMethod || network || createdFrom || createdTo || sort === 'oldest')
  const start = activity.items.length > 0 ? 1 : 0
  const end = activity.items.length
  const hasNext = activity.items.length < activity.total
  const canLoadMore = hasNext && activity.page < MAX_ACTIVITY_PAGES
  const reachedDisplayLimit = hasNext && activity.page >= MAX_ACTIVITY_PAGES

  useEffect(() => {
    if (!activity.telemetrySessionKey) return
    recordConsumerUxEvent({
      dimensions: { entry_surface: 'activity' },
      name: 'activity_opened',
      session: { key: activity.telemetrySessionKey, kind: 'activity' },
    }, { onceKey: `${activity.telemetrySessionKey}:activity-opened` })
  }, [activity.telemetrySessionKey])

  const recordActivityAction = (
    name: 'activity_filter_changed' | 'activity_retry' | 'activity_row_opened',
    dimensions: {
      action?: 'clear' | 'load_more' | 'refresh' | 'retry' | 'switch'
      filter?: 'all' | 'breb' | 'completed' | 'date_range' | 'failed' | 'pix' | 'processing' | 'refunded'
      rail?: 'BREB' | 'PIX'
      status?: 'COMPLETED' | 'EXPIRED' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'UNKNOWN'
    } = {},
  ): void => {
    if (!activity.telemetrySessionKey) return
    recordConsumerUxEvent({
      dimensions,
      name,
      session: { key: activity.telemetrySessionKey, kind: 'activity' },
    })
  }

  const filterForParameter = (key: string, value: string): NonNullable<Parameters<typeof recordActivityAction>[1]>['filter'] => {
    if (key === 'rail') return value === 'PIX' ? 'pix' : value === 'BREB' ? 'breb' : 'all'
    if (key === 'from' || key === 'to') return value ? 'date_range' : 'all'
    if (value === 'PAYMENT_COMPLETED') return 'completed'
    if (value === 'PROCESSING_PAYMENT' || value === 'AWAITING_PAYMENT') return 'processing'
    if (value === 'PAYMENT_FAILED' || value === 'PAYMENT_EXPIRED' || value === 'WRONG_AMOUNT') return 'failed'
    return 'all'
  }

  const setParameter = (key: string, value: string): void => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.set('page', '1')
    setSearchParams(next)
    if (key !== 'page') {
      recordActivityAction('activity_filter_changed', {
        action: 'switch',
        filter: filterForParameter(key, value),
        rail: key === 'rail' && (value === 'PIX' || value === 'BREB') ? value : undefined,
      })
    }
  }

  const clearFilters = (): void => {
    setSearchParams(new URLSearchParams())
    recordActivityAction('activity_filter_changed', { action: 'clear', filter: 'all' })
  }

  const returnSearch = searchParams.toString()

  return (
    <ActivityPageShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--ab-green)]">
              {t('activity.eyebrow', 'Your payments')}
            </p>
            <h1 className="font-cereal text-3xl font-bold tracking-tight sm:text-4xl">
              {t('activity.title', 'Activity')}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ab-text-muted)] sm:text-base">
              {t('activity.subtitle', 'Track every payment, its current state, and the references available for support.')}
            </p>
          </div>
          <button
            aria-label={t('activity.refresh', 'Refresh Activity')}
            className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 text-sm font-semibold transition-colors hover:bg-[var(--ab-bg-subtle)] disabled:opacity-60 sm:self-auto"
            disabled={activity.isRefreshing || activity.status === 'loading' || activity.status === 'unauthenticated'}
            onClick={() => {
              recordActivityAction('activity_retry', { action: 'refresh' })
              void activity.refresh()
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={cn('h-4 w-4', activity.isRefreshing && 'animate-spin motion-reduce:animate-none')} />
            {activity.isRefreshing ? t('activity.refreshing', 'Refreshing…') : t('activity.refresh', 'Refresh')}
          </button>
        </div>

        <details className="mb-6 rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-card)] shadow-sm" open={hasFilters}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ab-green)]">
            <Filter aria-hidden="true" className="h-4 w-4" />
            {t('activity.filters.title', 'Filters')}
            {hasFilters && (
              <span className="rounded-full bg-[var(--ab-green-soft)] px-2 py-0.5 text-xs text-[var(--ab-green)]">
                {t('activity.filters.active', 'Active')}
              </span>
            )}
          </summary>
          <div className="grid gap-4 border-t border-[var(--ab-border)] p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--ab-text-secondary)]">
              {t('activity.filters.status', 'Status')}
              <select className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg)] px-3 text-sm" onChange={event => setParameter('status', event.target.value)} value={status ?? ''}>
                <option value="">{t('activity.filters.all_statuses', 'All statuses')}</option>
                {transactionStatuses.map(value => (
                  <option key={value} value={value}>{activityStatusPresentation(value, translateActivity).label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--ab-text-secondary)]">
              {t('activity.filters.rail', 'Payment rail')}
              <select className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg)] px-3 text-sm" onChange={event => setParameter('rail', event.target.value)} value={paymentMethod ?? ''}>
                <option value="">{t('activity.filters.all_rails', 'All rails')}</option>
                {paymentMethods.map(value => <option key={value} value={value}>{value === 'BREB' ? 'BRE-B' : value}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--ab-text-secondary)]">
              {t('activity.filters.network', 'Network')}
              <select className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg)] px-3 text-sm" onChange={event => setParameter('network', event.target.value)} value={network ?? ''}>
                <option value="">{t('activity.filters.all_networks', 'All networks')}</option>
                {networks.map(value => (
                  <option key={value} value={value}>
                    {value[0]}
                    {value.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--ab-text-secondary)]">
              {t('activity.filters.from', 'From')}
              <input className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg)] px-3 text-sm" onChange={event => setParameter('from', event.target.value)} type="date" value={createdFrom ?? ''} />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--ab-text-secondary)]">
              {t('activity.filters.to', 'To')}
              <input className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg)] px-3 text-sm" onChange={event => setParameter('to', event.target.value)} type="date" value={createdTo ?? ''} />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-[var(--ab-text-secondary)]">
              {t('activity.filters.sort', 'Order')}
              <select className="min-h-11 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg)] px-3 text-sm" onChange={event => setParameter('sort', event.target.value)} value={sort}>
                <option value="newest">{t('activity.filters.sort.newest', 'Newest first')}</option>
                <option value="oldest">{t('activity.filters.sort.oldest', 'Oldest first')}</option>
              </select>
            </label>
            {hasFilters && (
              <button className="min-h-11 justify-self-start rounded-xl px-3 text-sm font-semibold text-[var(--ab-green)] hover:bg-[var(--ab-green-soft)]" onClick={clearFilters} type="button">
                {t('activity.filters.clear', 'Clear filters')}
              </button>
            )}
          </div>
        </details>

        {activity.status === 'unauthenticated' && (
          <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-6 py-12 text-center shadow-sm">
            <WalletCards aria-hidden="true" className="mx-auto h-9 w-9 text-[var(--ab-green)]" />
            <h2 className="mt-4 text-xl font-bold">{t('activity.auth.title', 'Connect your wallet to view Activity')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ab-text-muted)]">{t('activity.auth.body', 'Activity is private and is loaded only for the wallet you authenticate.')}</p>
            <Link className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--ab-green)] px-5 text-sm font-bold text-white" to="/">
              {t('activity.auth.action', 'Go to payment')}
            </Link>
          </section>
        )}

        {activity.status === 'loading' && (
          <div aria-live="polite" className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-8 text-center text-sm text-[var(--ab-text-muted)]" role="status">
            {t('activity.loading', 'Loading Activity…')}
          </div>
        )}

        {(activity.status === 'error' || activity.status === 'offline' || activity.status === 'stale') && (
          <div className={cn('mb-4 rounded-2xl border px-4 py-3 text-sm', activity.status === 'stale' || activity.status === 'offline' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900')} role="alert">
            <p className="font-semibold">{activity.error ?? t('activity.error.default', 'Unable to load Activity right now.')}</p>
            {activity.status === 'stale' && <p className="mt-1">{t('activity.error.stale', 'Showing the last successfully loaded results.')}</p>}
            {activity.status === 'offline' && <p className="mt-1">{t('activity.error.offline', 'You appear to be offline. Loaded results remain available; reconnect and try again.')}</p>}
            <button
              className="mt-2 min-h-11 rounded-xl border border-current px-4 font-bold"
              onClick={() => {
                recordActivityAction('activity_retry', { action: 'retry' })
                void activity.refresh()
              }}
              type="button"
            >
              {t('activity.error.retry', 'Try again')}
            </button>
          </div>
        )}

        {activity.status === 'empty' && (
          <section className="rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-6 py-12 text-center shadow-sm">
            <h2 className="text-xl font-bold">{hasFilters ? t('activity.empty.filtered_title', 'No payments match these filters') : t('activity.empty.title', 'No payments yet')}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ab-text-muted)]">{hasFilters ? t('activity.empty.filtered_body', 'Clear or adjust the filters to see other payments.') : t('activity.empty.body', 'Your payments will appear here after they are accepted.')}</p>
          </section>
        )}

        {activity.items.length > 0 && (
          <section aria-label={t('activity.list.label', 'Payment Activity')} className="overflow-hidden rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] shadow-sm">
            <div className="divide-y divide-[var(--ab-border)]">
              {activity.items.map((item) => {
                const presentation = activityStatusPresentation(item.status, translateActivity)
                const targetAmount = formatActivityMoney(item.quote.targetAmount, item.quote.targetCurrency, locale)
                const sourceAmount = formatActivityMoney(item.quote.sourceAmount, item.quote.sourceCurrency, locale)
                const returnValue = returnSearch ? `?${returnSearch}` : ''
                const detailSearch = returnValue ? `?return=${encodeURIComponent(returnValue)}` : ''
                return (
                  <Link
                    aria-label={`${presentation.label}: ${item.recipientHint ?? t('activity.recipient.unavailable', 'Recipient unavailable')}, ${targetAmount}`}
                    className="grid min-h-[88px] grid-cols-[1fr_auto] gap-3 px-4 py-4 transition-colors hover:bg-[var(--ab-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ab-green)] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:px-6"
                    key={item.id}
                    onClick={() => recordActivityAction('activity_row_opened', {
                      rail: normalizeConsumerUxRail(item.quote.paymentMethod),
                      status: item.status === 'PAYMENT_COMPLETED'
                        ? 'COMPLETED'
                        : item.status === 'PAYMENT_EXPIRED'
                          ? 'EXPIRED'
                          : item.status === 'PAYMENT_FAILED'
                            ? 'FAILED'
                            : item.status === 'PROCESSING_PAYMENT'
                              ? 'PROCESSING'
                              : item.status === 'AWAITING_PAYMENT'
                                ? 'PENDING'
                                : 'UNKNOWN',
                    })}
                    to={`/activity/${item.id}${detailSearch}`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--ab-text)]">{item.recipientHint ?? t('activity.recipient.unavailable', 'Recipient unavailable')}</span>
                        <ActivityStatusPill label={presentation.label} tone={presentation.tone} />
                      </div>
                      <p className="mt-1 text-xs text-[var(--ab-text-muted)]">{formatActivityDateTime(item.timestamps.updatedAt, locale, t('activity.detail.unavailable', 'Unavailable'))}</p>
                    </div>
                    <div className="min-w-0 text-right sm:text-left">
                      <p className="font-cereal font-bold tabular-nums text-[var(--ab-text)]">{targetAmount}</p>
                      <p className="mt-1 text-xs tabular-nums text-[var(--ab-text-muted)]">
                        {sourceAmount}
                        {' '}
                        ·
                        {' '}
                        {item.quote.paymentMethod === 'BREB' ? 'BRE-B' : item.quote.paymentMethod}
                      </p>
                    </div>
                    <ChevronRight aria-hidden="true" className="hidden h-5 w-5 text-[var(--ab-text-muted)] sm:block" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {activity.items.length > 0 && (
          <div className="mt-5 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[var(--ab-text-muted)]">
              <p>{t('activity.pagination.count', 'Showing {start}–{end} of {total}', { end, start, total: activity.total })}</p>
              {activity.lastUpdatedAt && (
                <p className="mt-1 text-xs">
                  {t('activity.pagination.updated', 'Last updated {time}', {
                    time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(activity.lastUpdatedAt),
                  })}
                </p>
              )}
            </div>
            {canLoadMore && (
              <button
                aria-busy={activity.isRefreshing}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-5 font-semibold disabled:opacity-50"
                disabled={activity.isRefreshing}
                onClick={() => {
                  recordActivityAction('activity_retry', { action: 'load_more' })
                  setParameter('page', String(activity.page + 1))
                }}
                type="button"
              >
                {activity.isRefreshing
                  ? t('activity.pagination.loading_more', 'Loading more…')
                  : t('activity.pagination.load_more', 'Load more')}
              </button>
            )}
            {reachedDisplayLimit && (
              <p className="max-w-md text-sm leading-6 text-[var(--ab-text-muted)]" role="status">
                {t('activity.pagination.limit_reached', 'Showing the first 500 payments. Use filters or a date range to find older payments.')}
              </p>
            )}
          </div>
        )}
      </main>
    </ActivityPageShell>
  )
}

export default ActivityListPage
