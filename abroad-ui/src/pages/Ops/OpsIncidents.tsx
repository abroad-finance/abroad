import {
  ArrowRight, Clock3, Siren, UserRoundCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { OpsIncidentFilters } from '../../services/admin/incidentAdminApi'
import type {
  OpsIncidentListResponse,
  OpsIncidentSeverity,
  OpsWorkStatus,
} from '../../services/admin/incidentTypes'
import type { OpsSavedView } from '../../services/admin/opsInvestigationTypes'

import { listOpsIncidentOwners, listOpsIncidents } from '../../services/admin/incidentAdminApi'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  createOpsSavedView,
  deleteOpsSavedView,
  listOpsSavedViews,
  updateOpsSavedView,
} from '../../services/admin/opsInvestigationApi'
import {
  formatDateTime,
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'
import SavedViewsBar from './transactions/SavedViewsBar'

type IncidentFilterDraft = {
  kind: string
  ownerUserId: string
  query: string
  severity: '' | OpsIncidentSeverity
  status: '' | OpsWorkStatus
  team: string
  unowned: boolean
}

const severityValues: OpsIncidentSeverity[] = [
  'CRITICAL',
  'HIGH',
  'WARNING',
  'INFO',
]
const statusValues: OpsWorkStatus[] = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
]

const isSeverity = (value: null | string): value is OpsIncidentSeverity => (
  value !== null && severityValues.includes(value as OpsIncidentSeverity)
)

const isStatus = (value: null | string): value is OpsWorkStatus => (
  value !== null && statusValues.includes(value as OpsWorkStatus)
)

const readDraft = (params: URLSearchParams): IncidentFilterDraft => ({
  kind: params.get('kind') ?? '',
  ownerUserId: params.get('ownerUserId') ?? '',
  query: params.get('query') ?? '',
  severity: isSeverity(params.get('severity')) ? params.get('severity') as OpsIncidentSeverity : '',
  status: isStatus(params.get('status')) ? params.get('status') as OpsWorkStatus : '',
  team: params.get('team') ?? '',
  unowned: params.get('unowned') === 'true',
})

const toParams = (draft: IncidentFilterDraft, page = 1): URLSearchParams => {
  const params = new URLSearchParams()
  if (draft.query.trim()) params.set('query', draft.query.trim())
  if (draft.kind) params.set('kind', draft.kind)
  if (draft.severity) params.set('severity', draft.severity)
  if (draft.status) params.set('status', draft.status)
  if (draft.ownerUserId) params.set('ownerUserId', draft.ownerUserId)
  if (draft.team.trim()) params.set('team', draft.team.trim())
  if (draft.unowned) params.set('unowned', 'true')
  if (page > 1) params.set('page', String(page))
  return params
}

const toFilters = (draft: IncidentFilterDraft, page: number): OpsIncidentFilters => ({
  kind: draft.kind || undefined,
  ownerUserId: draft.unowned ? undefined : draft.ownerUserId || undefined,
  page,
  pageSize: 30,
  query: draft.query.trim() || undefined,
  severity: draft.severity || undefined,
  status: draft.status || undefined,
  team: draft.team.trim() || undefined,
  unowned: draft.unowned || undefined,
})

const severityTone = (severity: OpsIncidentSeverity) => {
  if (severity === 'CRITICAL') return 'danger' as const
  if (severity === 'HIGH') return 'warning' as const
  if (severity === 'WARNING') return 'info' as const
  return 'neutral' as const
}

const formatAge = (seconds: number): string => {
  if (seconds < 60) return '< 1 min'
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr`
  return `${Math.floor(seconds / 86_400)} d`
}

const OpsIncidents = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const applied = useMemo(() => readDraft(new URLSearchParams(paramsKey)), [paramsKey])
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const [draft, setDraft] = useState(applied)
  const [data, setData] = useState<null | OpsIncidentListResponse>(null)
  const [owners, setOwners] = useState<Awaited<ReturnType<typeof listOpsIncidentOwners>>>([])
  const [views, setViews] = useState<OpsSavedView[]>([])
  const [loading, setLoading] = useState(false)
  const [savedViewLoading, setSavedViewLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const isAuthenticated = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const canManageSavedViews = Boolean(session?.kind === 'ops_user' && session.permissions.includes('saved_views:manage'))

  useEffect(() => setDraft(applied), [applied])

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await listOpsIncidents(toFilters(applied, page)))
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Incidents could not be loaded')
    }
    finally {
      setLoading(false)
    }
  }, [
    applied,
    isAuthenticated,
    page,
  ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!isAuthenticated || session?.kind !== 'ops_user') return
    let active = true
    void Promise.all([listOpsIncidentOwners(), listOpsSavedViews('INCIDENTS')])
      .then(([nextOwners, nextViews]) => {
        if (active) {
          setOwners(nextOwners)
          setViews(nextViews)
        }
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Incident coordination options are unavailable')
      })
    return () => {
      active = false
    }
  }, [isAuthenticated, session?.kind])

  const currentSavedFilters = (): OpsSavedView['filters'] => ({
    kind: applied.kind || undefined,
    ownerUserId: applied.ownerUserId || undefined,
    query: applied.query || undefined,
    severity: applied.severity || undefined,
    status: applied.status || undefined,
    team: applied.team || undefined,
    unowned: applied.unowned || undefined,
  })

  const applySavedView = (view: OpsSavedView): void => {
    const next: IncidentFilterDraft = {
      kind: typeof view.filters.kind === 'string' ? view.filters.kind : '',
      ownerUserId: typeof view.filters.ownerUserId === 'string' ? view.filters.ownerUserId : '',
      query: typeof view.filters.query === 'string' ? view.filters.query : '',
      severity: isSeverity(view.filters.severity ?? null) ? view.filters.severity as OpsIncidentSeverity : '',
      status: isStatus(view.filters.status ?? null) ? view.filters.status as OpsWorkStatus : '',
      team: typeof view.filters.team === 'string' ? view.filters.team : '',
      unowned: view.filters.unowned === true,
    }
    setDraft(next)
    setSearchParams(toParams(next))
  }

  const createSavedView = async (input: { name: string, scope: 'PRIVATE' | 'TEAM' }): Promise<void> => {
    setSavedViewLoading(true)
    try {
      const created = await requestMutation({
        action: 'saved_view.create',
        execute: mutation => createOpsSavedView({
          filters: currentSavedFilters(),
          name: input.name,
          resource: 'INCIDENTS',
          scope: input.scope,
        }, mutation),
        resourceLabel: input.name,
        title: 'Save incident view',
      })
      setViews(current => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) setError(saveError instanceof Error ? saveError.message : 'View could not be saved')
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const updateSavedView = async (view: OpsSavedView): Promise<void> => {
    setSavedViewLoading(true)
    try {
      const updated = await requestMutation({
        action: 'saved_view.update',
        execute: mutation => updateOpsSavedView(view.id, { filters: currentSavedFilters() }, mutation),
        expectedVersion: view.version,
        resourceLabel: view.name,
        title: 'Replace incident view',
      })
      setViews(current => current.map(item => item.id === updated.id ? updated : item))
    }
    catch (updateError) {
      if (!isOpsMutationCancelledError(updateError)) setError(updateError instanceof Error ? updateError.message : 'View could not be updated')
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const deleteSavedView = async (view: OpsSavedView): Promise<void> => {
    setSavedViewLoading(true)
    try {
      await requestMutation({
        action: 'saved_view.delete',
        execute: mutation => deleteOpsSavedView(view.id, mutation),
        expectedVersion: view.version,
        resourceLabel: view.name,
        title: 'Delete incident view',
      })
      setViews(current => current.filter(item => item.id !== view.id))
    }
    catch (deleteError) {
      if (!isOpsMutationCancelledError(deleteError)) setError(deleteError instanceof Error ? deleteError.message : 'View could not be deleted')
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <OpsPageShell
      actions={(
        <>
          <Link className="ops-btn-neutral" to="/ops/incidents/handoff">
            <UserRoundCheck aria-hidden size={17} />
            Shift handoff
          </Link>
          <button className="ops-btn-ghost" disabled={!isAuthenticated || loading} onClick={() => void load()} type="button">Refresh</button>
        </>
      )}
      error={error}
      eyebrow="Work"
      keyRequiredMessage="Sign in to review production incidents."
      subtitle="Stable clusters of provider, liquidity, pricing, queue, webhook, treasury, and bridge anomalies—with explicit ownership and response guidance."
      title="Incident Center"
    >
      <section aria-label="Incident filters" className="ops-card mt-6 p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="ops-label">
            Search incident summary
            <input className="ops-input mt-2" name="incident-query" onChange={event => setDraft(current => ({ ...current, query: event.target.value }))} placeholder="Provider or failure mode" value={draft.query} />
          </label>
          <label className="ops-label">
            Kind
            <select className="ops-input mt-2" name="incident-kind" onChange={event => setDraft(current => ({ ...current, kind: event.target.value }))} value={draft.kind}>
              <option value="">All kinds</option>
              {[
                'BRIDGE',
                'LIQUIDITY',
                'PRICING',
                'PROVIDER',
                'QUEUE',
                'RATE_LIMIT',
                'TREASURY',
                'WEBHOOK',
              ].map(kind => <option key={kind} value={kind}>{humanizeStatus(kind)}</option>)}
            </select>
          </label>
          <label className="ops-label">
            Severity
            <select className="ops-input mt-2" name="incident-severity" onChange={event => setDraft(current => ({ ...current, severity: event.target.value as IncidentFilterDraft['severity'] }))} value={draft.severity}>
              <option value="">All severities</option>
              {severityValues.map(severity => <option key={severity} value={severity}>{humanizeStatus(severity)}</option>)}
            </select>
          </label>
          <label className="ops-label">
            State
            <select className="ops-input mt-2" name="incident-status" onChange={event => setDraft(current => ({ ...current, status: event.target.value as IncidentFilterDraft['status'] }))} value={draft.status}>
              <option value="">All states</option>
              {statusValues.map(status => <option key={status} value={status}>{humanizeStatus(status)}</option>)}
            </select>
          </label>
          <label className="ops-label">
            Owner
            <select className="ops-input mt-2" disabled={draft.unowned} name="incident-owner" onChange={event => setDraft(current => ({ ...current, ownerUserId: event.target.value }))} value={draft.ownerUserId}>
              <option value="">Any owner</option>
              {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
            </select>
          </label>
          <label className="ops-label">
            Team
            <input className="ops-input mt-2" maxLength={60} name="incident-team" onChange={event => setDraft(current => ({ ...current, team: event.target.value }))} value={draft.team} />
          </label>
          <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-ops-border bg-ops-bg px-3 py-2 text-sm text-ops-text">
            <input checked={draft.unowned} name="incident-unowned" onChange={event => setDraft(current => ({ ...current, ownerUserId: event.target.checked ? '' : current.ownerUserId, unowned: event.target.checked }))} type="checkbox" />
            Show only unowned work
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="ops-btn-primary" onClick={() => setSearchParams(toParams(draft))} type="button">Apply filters</button>
          <button
            className="ops-btn-neutral"
            onClick={() => {
              const empty = readDraft(new URLSearchParams())
              setDraft(empty)
              setSearchParams(new URLSearchParams())
            }}
            type="button"
          >
            Reset
          </button>
        </div>
      </section>

      {session?.kind === 'ops_user' && (
        <SavedViewsBar
          canManage={canManageSavedViews}
          loading={savedViewLoading}
          onApply={applySavedView}
          onCreate={createSavedView}
          onDelete={deleteSavedView}
          onUpdate={updateSavedView}
          resourceName="incidents"
          views={views}
        />
      )}

      {data && (
        <div className={`mt-6 ${loading ? 'opacity-60' : ''}`}>
          <div aria-label="Incident counts by state" className="flex flex-wrap gap-2">
            {data.statusCounts.map(item => (
              <button className="ops-btn-neutral min-h-10" key={item.value} onClick={() => setSearchParams(toParams({ ...applied, status: item.value }))} type="button">
                {humanizeStatus(item.value)}
                {' '}
                ·
                {item.count}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {data.items.map(incident => (
              <article className="ops-card p-4 sm:p-5" key={incident.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OpsStatusBadge label={humanizeStatus(incident.severity)} tone={severityTone(incident.severity)} />
                      <OpsStatusBadge label={humanizeStatus(incident.status)} tone={incident.status === 'RESOLVED' ? 'success' : incident.status === 'ACKNOWLEDGED' ? 'info' : 'warning'} />
                      <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{humanizeStatus(incident.kind)}</span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-ops-text">{incident.title}</h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-ops-muted">{incident.summary}</p>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs text-ops-muted">Age</dt>
                        <dd className="mt-0.5 font-medium">
                          <Clock3 aria-hidden className="mr-1 inline" size={14} />
                          {formatAge(incident.ageSeconds)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ops-muted">Affected work</dt>
                        <dd className="mt-0.5 font-medium">{incident.affectedCount}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ops-muted">Occurrences</dt>
                        <dd className="mt-0.5 font-medium">{incident.occurrenceCount}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ops-muted">Owner</dt>
                        <dd className="mt-0.5 font-medium">{incident.owner?.displayName ?? incident.team ?? 'Unowned'}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 text-xs text-ops-muted">
                      Last seen
                      {formatDateTime(incident.lastSeenAt)}
                    </div>
                  </div>
                  <Link className="ops-btn-neutral shrink-0" to={`/ops/incidents/${incident.id}`}>
                    Investigate
                    {' '}
                    <ArrowRight aria-hidden size={16} />
                  </Link>
                </div>
              </article>
            ))}
            {data.items.length === 0 && (
              <OpsEmptyState className="mt-4">
                <strong className="block text-ops-text">No incidents match this view</strong>
                <span className="mt-1 block">The detector found no matching operational exception. Reset filters to review resolved or differently owned work.</span>
              </OpsEmptyState>
            )}
          </div>
          <OpsPagination onChange={next => setSearchParams(toParams(applied, next))} page={data.page} totalPages={totalPages} />
        </div>
      )}
      {loading && !data && <OpsLoading className="mt-8" label="Loading incident clusters…" />}
      {!data && !loading && isAuthenticated && !error && (
        <OpsEmptyState className="mt-8">
          <strong className="block text-ops-text">Incident evidence is not available yet</strong>
          <span className="mt-1 block">Refresh after the next detector cycle. No customer or provider state is changed by this page.</span>
        </OpsEmptyState>
      )}
      {!isAuthenticated && (
        <div className="ops-card mt-6 flex items-start gap-3 p-4 text-sm text-ops-muted">
          <Siren aria-hidden className="mt-0.5 shrink-0" size={18} />
          Named Ops access is required to view incident evidence.
        </div>
      )}
    </OpsPageShell>
  )
}

export default OpsIncidents
