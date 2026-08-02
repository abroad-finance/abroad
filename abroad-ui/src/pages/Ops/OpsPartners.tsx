import {
  ArrowRight,
  Building2,
  FilterX,
  Search,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type {
  OpsPartnerActivityFilter,
  OpsPartnerAnalyticsRange,
  OpsPartnerDirectoryResponse,
  OpsPartnerLifecycleFilter,
} from '../../services/admin/partnerAnalyticsTypes'

import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import { listOpsPartnerDirectory } from '../../services/admin/partnerAnalyticsAdminApi'
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
} from './shared'

const PAGE_SIZE = 20
const ranges: Array<{ label: string, value: OpsPartnerAnalyticsRange }> = [
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
]

type DirectoryDraft = {
  activity: '' | OpsPartnerActivityFilter
  country: string
  lifecycle: '' | OpsPartnerLifecycleFilter
  query: string
  range: OpsPartnerAnalyticsRange
}

const isRange = (value: null | string): value is OpsPartnerAnalyticsRange => (
  ranges.some(range => range.value === value)
)

const isActivity = (value: null | string): value is OpsPartnerActivityFilter => (
  value === 'ACTIVE' || value === 'INACTIVE'
)

const isLifecycle = (value: null | string): value is OpsPartnerLifecycleFilter => (
  value === 'LIVE' || value === 'NO_CREDENTIALS' || value === 'ONBOARDING'
)

const lifecycleTone = (lifecycle: OpsPartnerLifecycleFilter) => {
  if (lifecycle === 'LIVE') return 'success' as const
  if (lifecycle === 'NO_CREDENTIALS') return 'danger' as const
  return 'warning' as const
}

const VolumeBreakdown = ({ amounts, kind }: {
  amounts: Array<{ amount: number, currency: string }>
  kind: 'payout' | 'source'
}) => (
  <div className="flex flex-wrap gap-1.5">
    {amounts.length === 0
      ? (
          <span className="text-xs text-ops-muted">
            No completed
            {kind}
            {' '}
            volume
          </span>
        )
      : amounts.map(item => (
          <span className="rounded-full border border-ops-border bg-white px-2 py-1 text-[11px] font-semibold tabular-nums text-ops-text" key={item.currency}>
            {kind === 'payout' ? formatMoney(item.amount, item.currency) : `${formatAmount(item.amount)} ${item.currency}`}
          </span>
        ))}
  </div>
)

const OpsPartners = () => {
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const applied = useMemo<DirectoryDraft>(() => ({
    activity: isActivity(searchParams.get('activity')) ? searchParams.get('activity') as OpsPartnerActivityFilter : '',
    country: searchParams.get('country')?.trim().toUpperCase() ?? '',
    lifecycle: isLifecycle(searchParams.get('lifecycle')) ? searchParams.get('lifecycle') as OpsPartnerLifecycleFilter : '',
    query: searchParams.get('query')?.trim() ?? '',
    range: isRange(searchParams.get('range')) ? searchParams.get('range') as OpsPartnerAnalyticsRange : '30d',
  }), [searchParams])
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [draft, setDraft] = useState(applied)
  const [data, setData] = useState<null | OpsPartnerDirectoryResponse>(null)
  const [countries, setCountries] = useState<string[]>([])
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const requestSequence = useRef(0)

  useEffect(() => setDraft(applied), [applied])

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    if (!opsApiKey) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await listOpsPartnerDirectory({
        activity: applied.activity || undefined,
        country: applied.country || undefined,
        lifecycle: applied.lifecycle || undefined,
        page,
        pageSize: PAGE_SIZE,
        query: applied.query || undefined,
        range: applied.range,
      })
      if (sequence !== requestSequence.current) return
      setData(response)
      setCountries(current => [...new Set([...current, ...response.filterOptions.countries])].sort())
    }
    catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'Partner activity could not be loaded')
      }
    }
    finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [
    applied.activity,
    applied.country,
    applied.lifecycle,
    applied.query,
    applied.range,
    opsApiKey,
    page,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const applyFilters = (): void => {
    const next = new URLSearchParams()
    if (draft.query.trim()) next.set('query', draft.query.trim())
    if (draft.country) next.set('country', draft.country)
    if (draft.lifecycle) next.set('lifecycle', draft.lifecycle)
    if (draft.activity) next.set('activity', draft.activity)
    if (draft.range !== '30d') next.set('range', draft.range)
    setSearchParams(next)
  }

  const clearFilters = (): void => setSearchParams({})
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  return (
    <OpsPageShell
      actions={session?.permissions.includes('credentials:manage')
        ? <Link className="ops-btn-neutral" to="/ops/partners/credentials">Manage credentials</Link>
        : undefined}
      error={error}
      eyebrow="Partners & Compliance / Partners"
      keyRequiredMessage="Sign in to review partner activity."
      subtitle="Read-oriented partner activity ranked by completed stablecoin volume for the selected window. Currency amounts remain separate."
      title="Partner activity"
      width="full"
    >
      <form
        className="ops-card mt-6 grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_repeat(4,minmax(9rem,0.7fr))_auto] xl:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters()
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="ops-label">Partner search</span>
          <span className="relative">
            <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-ops-muted" size={17} />
            <input autoComplete="off" className="ops-input w-full pl-9" name="partner-search" onChange={event => setDraft(current => ({ ...current, query: event.target.value }))} placeholder="Name or exact ID" value={draft.query} />
          </span>
        </label>
        <label className="flex flex-col gap-2">
          <span className="ops-label">Country</span>
          <select className="ops-input" name="partner-country" onChange={event => setDraft(current => ({ ...current, country: event.target.value }))} value={draft.country}>
            <option value="">All countries</option>
            {countries.map(country => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="ops-label">Lifecycle</span>
          <select className="ops-input" name="partner-lifecycle" onChange={event => setDraft(current => ({ ...current, lifecycle: event.target.value as DirectoryDraft['lifecycle'] }))} value={draft.lifecycle}>
            <option value="">All lifecycle states</option>
            <option value="LIVE">Live</option>
            <option value="ONBOARDING">Onboarding</option>
            <option value="NO_CREDENTIALS">No credentials</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="ops-label">Activity</span>
          <select className="ops-input" name="partner-activity" onChange={event => setDraft(current => ({ ...current, activity: event.target.value as DirectoryDraft['activity'] }))} value={draft.activity}>
            <option value="">Any activity</option>
            <option value="ACTIVE">Has transactions</option>
            <option value="INACTIVE">No transactions</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="ops-label">Time window</span>
          <select className="ops-input" name="partner-range" onChange={event => setDraft(current => ({ ...current, range: event.target.value as OpsPartnerAnalyticsRange }))} value={draft.range}>
            {ranges.map(range => <option key={range.value} value={range.value}>{range.label}</option>)}
          </select>
        </label>
        <button className="ops-btn-primary" disabled={loading} type="submit">Apply</button>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ops-muted">
        <span aria-live="polite">
          {data ? `${data.total.toLocaleString('en-US')} partners · ${formatDateTime(data.from)} to ${formatDateTime(data.to)}` : 'Select a time window to compare partner activity.'}
          {loading && data ? ' · Refreshing' : ''}
        </span>
        {(applied.query || applied.country || applied.lifecycle || applied.activity || applied.range !== '30d') && (
          <button className="ops-btn-neutral ops-btn-sm" onClick={clearFilters} type="button">
            <FilterX aria-hidden size={15} />
            Clear filters
          </button>
        )}
      </div>

      {loading && !data && <OpsLoading className="mt-6" label="Ranking partner activity…" />}
      {!loading && data?.items.length === 0 && (
        <OpsEmptyState action={<button className="ops-btn-neutral" onClick={clearFilters} type="button">Show all partners</button>} className="mt-6">
          No partners match this activity view.
        </OpsEmptyState>
      )}

      {data && data.items.length > 0 && (
        <section aria-label="Partners ranked by completed stablecoin volume" className={`mt-6 grid gap-4 xl:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
          {data.items.map((partner, index) => {
            const rank = (data.page - 1) * data.pageSize + index + 1
            const width = data.maximumStablecoinAmount > 0 ? Math.max(1, (partner.stablecoinAmount / data.maximumStablecoinAmount) * 100) : 0
            return (
              <article className="ops-card min-w-0 p-5" key={partner.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-label={`Volume rank ${rank}`} className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-800">
                      #
                      {rank}
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-ops-text">{partner.name}</h2>
                      <p className="mt-0.5 text-xs text-ops-muted">
                        {partner.country ?? 'Country not set'}
                        {' '}
                        · joined
                        {' '}
                        {formatDateTime(partner.createdAt)}
                      </p>
                    </div>
                  </div>
                  <OpsStatusBadge label={humanizeStatus(partner.lifecycle)} tone={lifecycleTone(partner.lifecycle)} />
                </div>

                <div className="mt-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-2xl font-semibold tabular-nums text-ops-text">{formatAmount(partner.stablecoinAmount)}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">USD stablecoins</span>
                  </div>
                  <svg aria-label={`${formatAmount(partner.stablecoinAmount)} stablecoin volume`} className="mt-2 h-2 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 100 8">
                    <rect fill="#e7e5e4" height="8" rx="4" width="100" />
                    <rect fill="#1B4D48" height="8" rx="4" width={width} />
                  </svg>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-ops-bg p-3 text-center">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-ops-muted">Transactions</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{partner.totalTransactions}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-ops-muted">Completed</dt>
                    <dd className="mt-1 font-semibold tabular-nums text-emerald-700">{partner.completedTransactions}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-ops-muted">Success</dt>
                    <dd className="mt-1 font-semibold tabular-nums">{partner.successRatePct === null ? '—' : `${formatAmount(partner.successRatePct, 1)}%`}</dd>
                  </div>
                </dl>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 ops-label">Received</div>
                    <VolumeBreakdown amounts={partner.sourceVolume} kind="source" />
                  </div>
                  <div>
                    <div className="mb-2 ops-label">Paid out</div>
                    <VolumeBreakdown amounts={partner.payoutVolume} kind="payout" />
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2 border-t border-ops-border pt-4 sm:flex-row sm:justify-between">
                  <Link className="ops-btn-neutral" to={`/ops/transactions?partnerId=${encodeURIComponent(partner.id)}&createdFrom=${encodeURIComponent(data.from)}&createdTo=${encodeURIComponent(data.to)}`}>Transactions</Link>
                  <Link className="ops-btn-primary" to={`/ops/partners/${encodeURIComponent(partner.id)}?range=${applied.range}`}>
                    Open scorecard
                    <ArrowRight aria-hidden size={16} />
                  </Link>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {data && data.total > PAGE_SIZE && (
        <OpsPagination
          className="mt-6"
          onChange={nextPage => setSearchParams((current) => {
            const next = new URLSearchParams(current)
            if (nextPage === 1) next.delete('page')
            else next.set('page', String(nextPage))
            return next
          })}
          page={page}
          totalPages={totalPages}
        />
      )}

      {!opsApiKey && (
        <div className="ops-card mt-6 flex items-center gap-3 p-4 text-sm text-ops-muted">
          <Building2 aria-hidden size={20} />
          Named Ops access is required to load partner activity.
        </div>
      )}
    </OpsPageShell>
  )
}

export default OpsPartners
