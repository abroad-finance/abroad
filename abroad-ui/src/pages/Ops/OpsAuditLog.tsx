import {
  ExternalLink, Filter, History, Search,
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
  OpsAuditEvent,
  OpsAuditSearchFilters,
} from '../../services/admin/administrationTypes'

import { listOpsAuditEvents } from '../../services/admin/administrationAdminApi'
import { useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
} from './shared'

const PAGE_SIZE = 30

type AuditFilterDraft = {
  action: string
  actor: string
  createdFrom: string
  createdTo: string
  resourceId: string
  resourceType: string
}

const emptyFilters: AuditFilterDraft = {
  action: '',
  actor: '',
  createdFrom: '',
  createdTo: '',
  resourceId: '',
  resourceType: '',
}

const readFilters = (params: URLSearchParams): AuditFilterDraft => ({
  action: params.get('action') ?? '',
  actor: params.get('actor') ?? '',
  createdFrom: params.get('createdFrom') ?? '',
  createdTo: params.get('createdTo') ?? '',
  resourceId: params.get('resourceId') ?? '',
  resourceType: params.get('resourceType') ?? '',
})

const readPage = (params: URLSearchParams): number => {
  const parsed = Number(params.get('page'))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const toIsoDate = (value: string): string | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const getResourceHref = (event: OpsAuditEvent): null | string => {
  const id = event.resourceId
  switch (event.resourceType) {
    case 'configuration_release':
    case 'ops_configuration_release': return id
      ? `/ops/configuration/history?release=${encodeURIComponent(id)}`
      : '/ops/configuration/history'
    case 'crypto_asset': return '/ops/crypto-assets'
    case 'flow_corridor':
    case 'flow_definition': return '/ops/flows/definitions'
    case 'flow_instance': return id ? `/ops/flows/${encodeURIComponent(id)}` : '/ops/flows'
    case 'kyc_submission':
    case 'partner_user': return '/ops/kyc'
    case 'ops_user': return '/ops/administration/users'
    case 'partner': return '/ops/partners'
    case 'transaction': return id ? `/ops/transactions/${encodeURIComponent(id)}` : '/ops/transactions'
    default: return null
  }
}

const AuditEventCard = ({ event }: { event: OpsAuditEvent }) => {
  const resourceHref = getResourceHref(event)
  const metadata = event.metadata
    ? Object.entries(event.metadata).sort(([left], [right]) => (
        left.localeCompare(right)
      ))
    : []

  return (
    <article className="relative grid min-w-0 gap-4 border-l border-ops-border pb-7 pl-7 last:border-transparent last:pb-0 md:grid-cols-[12rem_minmax(0,1fr)]">
      <span
        aria-hidden
        className="absolute -left-2 top-1.5 size-4 rounded-full border-4 border-ops-bg bg-ops-brand"
      />
      <div className="min-w-0">
        <time className="text-sm font-semibold text-ops-text" dateTime={event.createdAt}>
          {formatDateTime(event.createdAt)}
        </time>
        <div className="mt-1 break-words text-xs text-ops-muted">{event.actorLabel}</div>
        <div className="mt-2">
          <OpsStatusBadge tone="neutral">{humanizeStatus(event.actorKind)}</OpsStatusBadge>
        </div>
      </div>

      <div className="ops-card min-w-0 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold text-ops-text">
              {humanizeStatus(event.action)}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ops-muted">
              <span>{humanizeStatus(event.resourceType)}</span>
              {event.resourceId && (
                <code className="max-w-full break-all rounded bg-ops-bg px-2 py-1 font-mono">
                  {event.resourceId}
                </code>
              )}
            </div>
          </div>
          {resourceHref && (
            <Link className="ops-btn-ghost ops-btn-sm shrink-0" to={resourceHref}>
              Open resource
              <ExternalLink aria-hidden size={14} />
            </Link>
          )}
        </div>

        {(event.reason || event.reference) && (
          <dl className="mt-4 grid gap-3 rounded-xl border border-ops-border bg-ops-bg p-3 text-sm sm:grid-cols-2">
            {event.reason && (
              <div className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Operational reason</dt>
                <dd className="mt-1 break-words text-ops-text">{event.reason}</dd>
              </div>
            )}
            {event.reference && (
              <div className="min-w-0">
                <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Reference</dt>
                <dd className="mt-1 break-all font-mono text-xs text-ops-text">{event.reference}</dd>
              </div>
            )}
          </dl>
        )}

        {metadata.length > 0 && (
          <details className="mt-4 rounded-xl border border-ops-border px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-ops-text">
              Safe event metadata
            </summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {metadata.map(([key, value]) => (
                <div className="min-w-0" key={key}>
                  <dt className="break-all font-mono text-xs text-ops-muted">{key}</dt>
                  <dd className="mt-0.5 break-all text-sm text-ops-text">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </article>
  )
}

const OpsAuditLog = () => {
  const session = useOpsSession()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryString = searchParams.toString()
  const appliedFilters = useMemo(() => readFilters(new URLSearchParams(queryString)), [queryString])
  const page = useMemo(() => readPage(new URLSearchParams(queryString)), [queryString])
  const [draft, setDraft] = useState<AuditFilterDraft>(appliedFilters)
  const [events, setEvents] = useState<OpsAuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const requestSequence = useRef(0)
  const canRead = Boolean(session?.permissions.includes('administration:audit'))

  useEffect(() => {
    setDraft(appliedFilters)
  }, [appliedFilters])

  const load = useCallback(async () => {
    if (!canRead) {
      setEvents([])
      setTotal(0)
      return
    }
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setLoading(true)
    setError(null)
    const filters: OpsAuditSearchFilters = {
      action: appliedFilters.action || undefined,
      actor: appliedFilters.actor || undefined,
      createdFrom: toIsoDate(appliedFilters.createdFrom),
      createdTo: toIsoDate(appliedFilters.createdTo),
      page,
      pageSize: PAGE_SIZE,
      resourceId: appliedFilters.resourceId || undefined,
      resourceType: appliedFilters.resourceType || undefined,
    }
    try {
      const response = await listOpsAuditEvents(filters)
      if (requestSequence.current !== sequence) return
      setEvents(response.items)
      setTotal(response.total)
    }
    catch (loadError) {
      if (requestSequence.current !== sequence) return
      setError(loadError instanceof Error ? loadError.message : 'Failed to load audit evidence')
    }
    finally {
      if (requestSequence.current === sequence) setLoading(false)
    }
  }, [
    appliedFilters,
    canRead,
    page,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const applyFilters = (): void => {
    const next = new URLSearchParams()
    Object.entries(draft).forEach(([key, value]) => {
      const trimmed = value.trim()
      if (trimmed) next.set(key, trimmed)
    })
    setSearchParams(next)
  }

  const clearFilters = (): void => {
    setDraft(emptyFilters)
    setSearchParams(new URLSearchParams())
  }

  const changePage = (nextPage: number): void => {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) next.delete('page')
    else next.set('page', String(nextPage))
    setSearchParams(next)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasAppliedFilters = Object.values(appliedFilters).some(Boolean)

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost" disabled={!canRead || loading} onClick={() => void load()} type="button">
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Administration"
      subtitle="Trace who viewed or changed production operations, why they acted, and which resource was affected."
      title="Audit Log"
      width="full"
    >
      {!canRead && session && (
        <OpsBanner className="mt-6" variant="warning">
          Your current role cannot view the production audit trail.
        </OpsBanner>
      )}

      {canRead && (
        <>
          <section aria-labelledby="audit-filters" className="ops-card mt-8 p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ops-brand/10 text-ops-brand">
                <Filter aria-hidden size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ops-text" id="audit-filters">Find audit evidence</h2>
                <p className="mt-1 text-sm text-ops-muted">Filters apply together and remain in the URL for handoff or review.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <OpsField label="Actor">
                <input
                  autoComplete="off"
                  className="ops-input"
                  name="audit-actor"
                  onChange={event => setDraft(current => ({ ...current, actor: event.target.value }))}
                  placeholder="Name or organization account"
                  value={draft.actor}
                />
              </OpsField>
              <OpsField label="Action">
                <input
                  autoComplete="off"
                  className="ops-input"
                  name="audit-action"
                  onChange={event => setDraft(current => ({ ...current, action: event.target.value }))}
                  placeholder="For example, role update"
                  value={draft.action}
                />
              </OpsField>
              <OpsField label="Resource type">
                <input
                  autoComplete="off"
                  className="ops-input"
                  name="audit-resource-type"
                  onChange={event => setDraft(current => ({ ...current, resourceType: event.target.value }))}
                  placeholder="Transaction, partner, Ops user…"
                  value={draft.resourceType}
                />
              </OpsField>
              <OpsField label="Resource ID">
                <input
                  autoComplete="off"
                  className="ops-input font-mono"
                  name="audit-resource-id"
                  onChange={event => setDraft(current => ({ ...current, resourceId: event.target.value }))}
                  placeholder="Internal resource identifier"
                  value={draft.resourceId}
                />
              </OpsField>
              <OpsField label="From">
                <input
                  className="ops-input"
                  name="audit-created-from"
                  onChange={event => setDraft(current => ({ ...current, createdFrom: event.target.value }))}
                  type="datetime-local"
                  value={draft.createdFrom}
                />
              </OpsField>
              <OpsField label="To">
                <input
                  className="ops-input"
                  name="audit-created-to"
                  onChange={event => setDraft(current => ({ ...current, createdTo: event.target.value }))}
                  type="datetime-local"
                  value={draft.createdTo}
                />
              </OpsField>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="ops-btn-primary" onClick={applyFilters} type="button">
                <Search aria-hidden size={16} />
                Apply filters
              </button>
              <button className="ops-btn-neutral" disabled={!hasAppliedFilters} onClick={clearFilters} type="button">
                Clear filters
              </button>
            </div>
          </section>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <History aria-hidden className="text-ops-brand" size={20} />
              <div>
                <h2 className="font-semibold text-ops-text">Chronological evidence</h2>
                <p className="text-sm text-ops-muted">
                  {total.toLocaleString('en-US')}
                  {' '}
                  matching events, newest first
                </p>
              </div>
            </div>
            {totalPages > 1 && (
              <OpsPagination loading={loading} onChange={changePage} page={page} totalPages={totalPages} />
            )}
          </div>

          {loading && events.length === 0 && <div className="mt-6"><OpsLoading label="Loading audit evidence…" /></div>}
          {!loading && events.length === 0 && (
            <OpsEmptyState
              action={hasAppliedFilters
                ? <button className="ops-btn-neutral" onClick={clearFilters} type="button">Clear filters</button>
                : undefined}
              className="mt-6"
            >
              {hasAppliedFilters
                ? 'No audit evidence matches these filters.'
                : 'No audit evidence has been recorded yet.'}
            </OpsEmptyState>
          )}

          {events.length > 0 && (
            <section aria-label="Audit evidence timeline" className="mt-6 pl-2">
              {loading && <OpsBanner className="mb-4" variant="info">Refreshing audit evidence…</OpsBanner>}
              {events.map(event => <AuditEventCard event={event} key={event.id} />)}
            </section>
          )}
        </>
      )}
    </OpsPageShell>
  )
}

export default OpsAuditLog
