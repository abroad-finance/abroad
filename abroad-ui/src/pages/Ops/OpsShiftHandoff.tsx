import { ArrowRight, MessageSquareWarning, UserRoundCheck } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { OpsHandoffBoard, OpsHandoffScope } from '../../services/admin/incidentTypes'

import { getOpsShiftHandoff } from '../../services/admin/incidentAdminApi'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
} from './shared'

const scopes: Array<{ label: string, value: OpsHandoffScope }> = [
  { label: 'All unresolved', value: 'ALL' },
  { label: 'Assigned to me', value: 'MINE' },
  { label: 'Unowned', value: 'UNOWNED' },
]

const isScope = (value: null | string): value is OpsHandoffScope => (
  value !== null && scopes.some(scope => scope.value === value)
)

const formatAge = (seconds: number): string => {
  if (seconds < 3_600) return `${Math.max(1, Math.floor(seconds / 60))} min`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} hr`
  return `${Math.floor(seconds / 86_400)} d`
}

const OpsShiftHandoff = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = isScope(searchParams.get('scope')) ? searchParams.get('scope') as OpsHandoffScope : 'ALL'
  const [data, setData] = useState<null | OpsHandoffBoard>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const isAuthenticated = useOpsApiKey()

  const load = useCallback(async () => {
    if (!isAuthenticated) return
    setLoading(true)
    setError(null)
    try {
      setData(await getOpsShiftHandoff(scope))
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Shift handoff could not be loaded')
    }
    finally {
      setLoading(false)
    }
  }, [isAuthenticated, scope])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <OpsPageShell
      actions={<button className="ops-btn-ghost" disabled={!isAuthenticated || loading} onClick={() => void load()} type="button">Refresh</button>}
      backLink={{ label: 'Back to Incident Center', to: '/ops/incidents' }}
      error={error}
      eyebrow="Work / Shift handoff"
      keyRequiredMessage="Sign in to review unresolved work."
      subtitle="A bounded queue of unresolved cases and incidents, with current responsibility, prior escalation, and direct paths to transfer ownership."
      title="Shift Handoff"
    >
      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          <section aria-label="Handoff workload counts" className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="ops-card p-4">
              <div className="text-xs text-ops-muted">Unresolved in view</div>
              <div className="mt-1 text-3xl font-semibold">{data.counts.total}</div>
            </div>
            <div className="ops-card p-4">
              <div className="text-xs text-ops-muted">Assigned to me</div>
              <div className="mt-1 text-3xl font-semibold">{data.counts.mine}</div>
            </div>
            <div className="ops-card p-4">
              <div className="text-xs text-ops-muted">Unowned</div>
              <div className="mt-1 text-3xl font-semibold text-amber-700">{data.counts.unowned}</div>
            </div>
          </section>
          <div aria-label="Handoff scope" className="mt-5 flex flex-wrap gap-2" role="group">
            {scopes.map(option => (
              <button
                aria-pressed={scope === option.value}
                className={scope === option.value ? 'ops-btn-primary' : 'ops-btn-neutral'}
                key={option.value}
                onClick={() => setSearchParams(option.value === 'ALL' ? {} : { scope: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <section aria-label="Unresolved handoff work" className="mt-5 space-y-3">
            {data.items.map(item => (
              <article className="ops-card p-4 sm:p-5" key={`${item.resourceType}-${item.id}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OpsStatusBadge label={humanizeStatus(item.resourceType)} tone={item.resourceType === 'INCIDENT' ? 'warning' : 'info'} />
                      <OpsStatusBadge label={humanizeStatus(item.status)} tone={item.status === 'ACKNOWLEDGED' ? 'info' : 'warning'} />
                      <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{humanizeStatus(item.priority)}</span>
                    </div>
                    <h2 className="mt-3 text-base font-semibold text-ops-text">{item.title}</h2>
                    <p className="mt-1 text-sm text-ops-muted">{item.subtitle}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ops-muted">
                      <span>
                        Age
                        {formatAge(item.ageSeconds)}
                      </span>
                      <span>
                        Owner
                        {item.owner?.displayName ?? item.team ?? 'Unowned'}
                      </span>
                      <span>
                        Updated
                        {formatDateTime(item.updatedAt)}
                      </span>
                    </div>
                    {item.latestEscalation && (
                      <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                          <MessageSquareWarning aria-hidden size={15} />
                          Latest escalation ·
                          {' '}
                          {item.latestEscalation.author}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words leading-6">{item.latestEscalation.summary}</p>
                      </div>
                    )}
                  </div>
                  <Link className="ops-btn-neutral shrink-0" to={item.href}>
                    {item.owner ? 'Review or transfer' : 'Assign owner'}
                    <ArrowRight aria-hidden size={16} />
                  </Link>
                </div>
              </article>
            ))}
            {data.items.length === 0 && (
              <OpsEmptyState>
                <UserRoundCheck aria-hidden className="mx-auto mb-2 text-ops-brand" size={24} />
                No unresolved work matches this handoff scope.
              </OpsEmptyState>
            )}
          </section>
        </div>
      )}
      {loading && !data && <OpsLoading className="mt-8" label="Preparing shift handoff…" />}
    </OpsPageShell>
  )
}

export default OpsShiftHandoff
