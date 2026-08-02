import {
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  UserRoundCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'

import type { OpsIncidentDetail, OpsNoteKind, OpsWorkStatus } from '../../services/admin/incidentTypes'
import type { OpsMutationDetails } from '../../services/admin/opsMutationTypes'

import {
  addOpsIncidentNote,
  getOpsIncident,
  handoffOpsIncident,
  listOpsIncidentOwners,
  listOpsIncidentRunbooks,
  updateOpsIncident,
} from '../../services/admin/incidentAdminApi'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

const severityTone = (severity: OpsIncidentDetail['severity']) => {
  if (severity === 'CRITICAL') return 'danger' as const
  if (severity === 'HIGH') return 'warning' as const
  if (severity === 'WARNING') return 'info' as const
  return 'neutral' as const
}

const OpsIncidentDetailPage = () => {
  const { incidentId = '' } = useParams()
  const [incident, setIncident] = useState<null | OpsIncidentDetail>(null)
  const [owners, setOwners] = useState<Awaited<ReturnType<typeof listOpsIncidentOwners>>>([])
  const [runbooks, setRunbooks] = useState<Awaited<ReturnType<typeof listOpsIncidentRunbooks>>>([])
  const [ownerUserId, setOwnerUserId] = useState('')
  const [team, setTeam] = useState('')
  const [runbookId, setRunbookId] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [handoffOwnerId, setHandoffOwnerId] = useState('')
  const [handoffTeam, setHandoffTeam] = useState('')
  const [handoffNote, setHandoffNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const isAuthenticated = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const canManage = Boolean(session?.kind === 'ops_user' && session.permissions.includes('incidents:manage'))

  const load = useCallback(async () => {
    if (!isAuthenticated || !incidentId) return
    setLoading(true)
    setError(null)
    try {
      const [
        nextIncident,
        nextOwners,
        nextRunbooks,
      ] = await Promise.all([
        getOpsIncident(incidentId),
        listOpsIncidentOwners(),
        listOpsIncidentRunbooks(),
      ])
      setIncident(nextIncident)
      setOwners(nextOwners)
      setRunbooks(nextRunbooks)
      setOwnerUserId(nextIncident.owner?.id ?? '')
      setTeam(nextIncident.team ?? '')
      setRunbookId(nextIncident.runbook?.id ?? '')
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Incident evidence could not be loaded')
    }
    finally {
      setLoading(false)
    }
  }, [incidentId, isAuthenticated])

  useEffect(() => {
    void load()
  }, [load])

  const runMutation = async (
    action: 'incident.escalate' | 'incident.handoff' | 'incident.note.add' | 'incident.update',
    title: string,
    execute: (mutation: OpsMutationDetails) => Promise<OpsIncidentDetail>,
    expectedVersion?: number,
  ): Promise<boolean> => {
    setWorking(true)
    setError(null)
    try {
      const updated = await requestMutation<OpsIncidentDetail>({
        action,
        execute,
        expectedVersion,
        resourceLabel: incident?.title,
        title,
      })
      setIncident(updated)
      setOwnerUserId(updated.owner?.id ?? '')
      setTeam(updated.team ?? '')
      setRunbookId(updated.runbook?.id ?? '')
      return true
    }
    catch (mutationError) {
      if (!isOpsMutationCancelledError(mutationError)) {
        setError(mutationError instanceof Error ? mutationError.message : 'Incident could not be updated')
      }
      return false
    }
    finally {
      setWorking(false)
    }
  }

  const updateState = async (status: OpsWorkStatus): Promise<void> => {
    if (!incident) return
    await runMutation(
      'incident.update',
      status === 'ACKNOWLEDGED' ? 'Acknowledge incident' : status === 'RESOLVED' ? 'Resolve incident' : 'Reopen incident',
      mutation => updateOpsIncident(incident.id, { status }, mutation),
      incident.version,
    )
  }

  const timeline = useMemo(() => {
    if (!incident) return []
    return [
      {
        at: incident.firstSeenAt, body: incident.summary, label: 'Incident first detected', tone: 'info',
      },
      ...incident.notes.map(note => ({
        at: note.createdAt,
        body: note.body,
        label: `${humanizeStatus(note.kind)} · ${note.author.displayName}`,
        tone: note.kind === 'ESCALATION' ? 'danger' : note.kind === 'RESOLUTION' ? 'success' : 'neutral',
      })),
      ...incident.handoffs.map(handoff => ({
        at: handoff.createdAt,
        body: `${handoff.note} → ${handoff.toUser?.displayName ?? handoff.toTeam ?? 'unassigned'}`,
        label: `Handoff · ${handoff.actor.displayName}`,
        tone: 'warning',
      })),
      {
        at: incident.lastSeenAt, body: `${incident.occurrenceCount} occurrences; ${incident.affectedCount} affected work items.`, label: 'Latest detector observation', tone: 'info',
      },
    ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
  }, [incident])

  return (
    <OpsPageShell
      actions={incident && canManage
        ? (
            <div className="flex flex-wrap gap-2">
              {incident.status === 'OPEN' && <button className="ops-btn-primary" disabled={working} onClick={() => void updateState('ACKNOWLEDGED')} type="button">Acknowledge</button>}
              {incident.status !== 'RESOLVED' && <button className="ops-btn-neutral" disabled={working} onClick={() => void updateState('RESOLVED')} type="button">Resolve</button>}
              {incident.status === 'RESOLVED' && <button className="ops-btn-neutral" disabled={working} onClick={() => void updateState('OPEN')} type="button">Reopen</button>}
            </div>
          )
        : undefined}
      backLink={{ label: 'Back to Incident Center', to: '/ops/incidents' }}
      error={error}
      eyebrow="Work / Incident"
      keyRequiredMessage="Sign in to inspect this production incident."
      subtitle={incident?.summary ?? 'Provider, payment, queue, webhook, treasury, and bridge evidence in one response workspace.'}
      title={incident?.title ?? 'Incident detail'}
    >
      {loading && !incident && <OpsLoading className="mt-8" label="Loading incident evidence…" />}
      {incident && (
        <div className={loading ? 'opacity-60' : ''}>
          <section aria-labelledby="incident-posture-title" className="ops-card mt-6 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <OpsStatusBadge label={humanizeStatus(incident.severity)} tone={severityTone(incident.severity)} />
              <OpsStatusBadge label={humanizeStatus(incident.status)} tone={incident.status === 'RESOLVED' ? 'success' : incident.status === 'ACKNOWLEDGED' ? 'info' : 'warning'} />
              <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{humanizeStatus(incident.kind)}</span>
            </div>
            <h2 className="sr-only" id="incident-posture-title">Incident posture</h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-ops-muted">First seen</dt>
                <dd className="mt-1 font-medium">{formatDateTime(incident.firstSeenAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ops-muted">Last seen</dt>
                <dd className="mt-1 font-medium">{formatDateTime(incident.lastSeenAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ops-muted">Affected / occurrences</dt>
                <dd className="mt-1 font-medium">
                  {incident.affectedCount}
                  {' '}
                  /
                  {' '}
                  {incident.occurrenceCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ops-muted">Responsibility</dt>
                <dd className="mt-1 font-medium">{incident.owner?.displayName ?? incident.team ?? 'Unowned'}</dd>
              </div>
            </dl>
            {incident.runbook && (
              <a className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-ops-border px-3 py-2 text-sm font-semibold text-ops-brand hover:border-ops-brand" href={incident.runbook.url} rel="noreferrer" target="_blank">
                <BookOpenCheck aria-hidden size={17} />
                {incident.runbook.name}
                <ExternalLink aria-hidden size={14} />
              </a>
            )}
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)]">
            <div className="space-y-6">
              <section aria-labelledby="affected-title" className="ops-card p-5 sm:p-6">
                <h2 className="text-lg font-semibold text-ops-text" id="affected-title">Affected work and investigation links</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {incident.context.filters.map(filter => (
                    <Link className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-ops-border bg-ops-bg px-3 py-2 text-sm font-semibold text-ops-brand hover:border-ops-brand" key={filter.path} to={filter.path}>
                      {filter.label}
                      <ArrowUpRight aria-hidden size={16} />
                    </Link>
                  ))}
                </div>
                {incident.context.affected.length > 0
                  ? (
                      <ul aria-label="Affected operational records" className="mt-5 grid gap-2 sm:grid-cols-2">
                        {incident.context.affected.map(resource => (
                          <li key={`${resource.type}-${resource.id}`}>
                            <Link className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-ops-border px-3 py-2 text-sm text-ops-text hover:border-ops-brand" to={resource.path}>
                              <span>
                                <span className="block text-xs text-ops-muted">{humanizeStatus(resource.type)}</span>
                                {resource.label}
                              </span>
                              <ArrowUpRight aria-hidden size={15} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )
                  : <OpsEmptyState className="mt-4">No individual record links are available for this aggregate incident.</OpsEmptyState>}
                {incident.context.dimensions.length > 0 && (
                  <dl className="mt-5 flex flex-wrap gap-2">
                    {incident.context.dimensions.map(dimension => (
                      <div className="rounded-full border border-ops-border bg-white px-3 py-1 text-xs" key={`${dimension.label}-${dimension.value}`}>
                        <dt className="inline text-ops-muted">
                          {dimension.label}
                          :
                          {' '}
                        </dt>
                        <dd className="inline font-semibold text-ops-text">{dimension.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              <section aria-labelledby="timeline-title" className="ops-card p-5 sm:p-6">
                <h2 className="text-lg font-semibold text-ops-text" id="timeline-title">Response timeline</h2>
                <ol className="mt-5 space-y-5">
                  {timeline.map((event, index) => (
                    <li className="relative pl-7" key={`${event.at}-${event.label}-${index}`}>
                      <span aria-hidden className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-white bg-ops-brand shadow" />
                      {index < timeline.length - 1 && <span aria-hidden className="absolute bottom-[-1.25rem] left-[5px] top-4 w-px bg-ops-border" />}
                      <div className="text-xs text-ops-muted">{formatDateTime(event.at)}</div>
                      <div className="mt-0.5 text-sm font-semibold text-ops-text">{event.label}</div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ops-muted">{event.body}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <aside aria-label="Incident coordination" className="space-y-6">
              <section aria-labelledby="coordination-title" className="ops-card p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold text-ops-text" id="coordination-title">
                  <ClipboardList aria-hidden size={18} />
                  Coordination
                </h2>
                {!canManage && <OpsBanner className="mt-4" variant="info">Your role can inspect this incident but cannot change ownership or state.</OpsBanner>}
                <div className="mt-4 space-y-4">
                  <OpsField label="Owner">
                    <select className="ops-input" disabled={!canManage || working} name="incident-detail-owner" onChange={event => setOwnerUserId(event.target.value)} value={ownerUserId}>
                      <option value="">Unassigned</option>
                      {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
                    </select>
                  </OpsField>
                  <OpsField label="Team">
                    <input className="ops-input" disabled={!canManage || working} maxLength={60} name="incident-detail-team" onChange={event => setTeam(event.target.value)} value={team} />
                  </OpsField>
                  <OpsField label="Runbook">
                    <select className="ops-input" disabled={!canManage || working} name="incident-detail-runbook" onChange={event => setRunbookId(event.target.value)} value={runbookId}>
                      <option value="">No runbook assigned</option>
                      {runbooks.map(runbook => <option key={runbook.id} value={runbook.id}>{runbook.name}</option>)}
                    </select>
                  </OpsField>
                  <button
                    className="ops-btn-primary w-full"
                    disabled={!canManage || working}
                    onClick={() => void runMutation(
                      'incident.update',
                      'Update incident coordination',
                      mutation => updateOpsIncident(incident.id, {
                        ownerUserId: ownerUserId || null,
                        runbookId: runbookId || null,
                        team: team.trim() || null,
                      }, mutation),
                      incident.version,
                    )}
                    type="button"
                  >
                    Apply coordination
                  </button>
                </div>
              </section>

              <section aria-labelledby="note-title" className="ops-card p-5">
                <h2 className="text-base font-semibold text-ops-text" id="note-title">Add response note</h2>
                <textarea className="ops-input mt-3 min-h-28" disabled={!canManage || working} maxLength={4_000} name="incident-note" onChange={event => setNoteBody(event.target.value)} placeholder="PII-free observation, decision, or escalation context" value={noteBody} />
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {(['NOTE', 'ESCALATION'] as OpsNoteKind[]).map(kind => (
                    <button
                      className={kind === 'ESCALATION' ? 'ops-btn-danger' : 'ops-btn-neutral'}
                      disabled={!canManage || working || !noteBody.trim()}
                      key={kind}
                      onClick={() => void (async () => {
                        const succeeded = await runMutation(
                          kind === 'ESCALATION' ? 'incident.escalate' : 'incident.note.add',
                          kind === 'ESCALATION' ? 'Escalate incident' : 'Add incident note',
                          mutation => addOpsIncidentNote(incident.id, noteBody.trim(), kind, mutation),
                        )
                        if (succeeded) setNoteBody('')
                      })()}
                      type="button"
                    >
                      {kind === 'ESCALATION' ? 'Escalate' : 'Add note'}
                    </button>
                  ))}
                </div>
              </section>

              <section aria-labelledby="handoff-title" className="ops-card p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold text-ops-text" id="handoff-title">
                  <UserRoundCheck aria-hidden size={18} />
                  Shift handoff
                </h2>
                <div className="mt-4 space-y-3">
                  <select aria-label="Handoff owner" className="ops-input" disabled={!canManage || working} name="incident-handoff-owner" onChange={event => setHandoffOwnerId(event.target.value)} value={handoffOwnerId}>
                    <option value="">Select an individual</option>
                    {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
                  </select>
                  <input aria-label="Handoff team" className="ops-input" disabled={!canManage || working} maxLength={60} name="incident-handoff-team" onChange={event => setHandoffTeam(event.target.value)} placeholder="Or receiving team" value={handoffTeam} />
                  <textarea aria-label="Handoff note" className="ops-input min-h-24" disabled={!canManage || working} maxLength={1_000} name="incident-handoff-note" onChange={event => setHandoffNote(event.target.value)} placeholder="What is known, what is pending, and when to escalate" value={handoffNote} />
                  <button
                    className="ops-btn-primary w-full"
                    disabled={!canManage || working || !handoffNote.trim() || (!handoffOwnerId && !handoffTeam.trim())}
                    onClick={() => void (async () => {
                      const succeeded = await runMutation(
                        'incident.handoff',
                        'Hand off incident',
                        mutation => handoffOpsIncident(incident.id, {
                          note: handoffNote.trim(),
                          toTeam: handoffTeam.trim() || null,
                          toUserId: handoffOwnerId || null,
                        }, mutation),
                        incident.version,
                      )
                      if (succeeded) {
                        setHandoffNote('')
                        setHandoffOwnerId('')
                        setHandoffTeam('')
                      }
                    })()}
                    type="button"
                  >
                    Hand off responsibility
                  </button>
                </div>
              </section>
            </aside>
          </div>

          {incident.status === 'RESOLVED' && (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 aria-hidden size={20} />
              Resolved
              {' '}
              {formatDateTime(incident.resolvedAt)}
              . The same fingerprint will reopen only if a newer anomaly is detected.
            </div>
          )}
        </div>
      )}
      {!loading && !incident && isAuthenticated && !error && <OpsEmptyState className="mt-8">This incident could not be found.</OpsEmptyState>}
    </OpsPageShell>
  )
}

export default OpsIncidentDetailPage
