import type { ReactNode } from 'react'

import {
  CalendarClock,
  CheckCircle2,
  GitCompareArrows,
  History,
  RotateCcw,
  Search,
  Send,
  XCircle,
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
  OpsConfigurationRelease,
  OpsConfigurationReleaseStatus,
  OpsConfigurationTargetType,
} from '../../services/admin/configurationReleaseTypes'

import {
  approveOpsConfigurationRelease,
  createOpsConfigurationRollback,
  getOpsConfigurationRelease,
  listOpsConfigurationReleases,
  rejectOpsConfigurationRelease,
  submitOpsConfigurationRelease,
  updateOpsConfigurationRelease,
} from '../../services/admin/configurationReleaseAdminApi'
import {
  opsConfigurationReleaseStatuses,
  opsConfigurationTargetTypes,
} from '../../services/admin/configurationReleaseTypes'
import { useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsDialog,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

const PAGE_SIZE = 20

type FilterDraft = {
  query: string
  status: '' | OpsConfigurationReleaseStatus
  targetType: '' | OpsConfigurationTargetType
}

const readPage = (params: URLSearchParams): number => {
  const page = Number(params.get('page'))
  return Number.isInteger(page) && page > 0 ? page : 1
}

const readStatus = (params: URLSearchParams): FilterDraft['status'] => {
  const value = params.get('status')
  return opsConfigurationReleaseStatuses.some(status => status === value)
    ? value as OpsConfigurationReleaseStatus
    : ''
}

const readTargetType = (params: URLSearchParams): FilterDraft['targetType'] => {
  const value = params.get('targetType')
  return opsConfigurationTargetTypes.some(targetType => targetType === value)
    ? value as OpsConfigurationTargetType
    : ''
}

const readFilters = (params: URLSearchParams): FilterDraft => ({
  query: params.get('query') ?? '',
  status: readStatus(params),
  targetType: readTargetType(params),
})

const toLocalDateTime = (value: null | string): string => {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const releaseTone = (status: OpsConfigurationReleaseStatus) => {
  if (status === 'APPLIED') return 'success' as const
  if (status === 'REJECTED' || status === 'ROLLED_BACK') return 'danger' as const
  if (status === 'PENDING_APPROVAL' || status === 'APPROVED') return 'warning' as const
  return 'neutral' as const
}

const ReleaseSummary = ({ onSelect, release, selected }: {
  onSelect: () => void
  release: OpsConfigurationRelease
  selected: boolean
}) => (
  <button
    aria-pressed={selected}
    className={`w-full rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-ops-brand bg-ops-brand/5' : 'border-ops-border bg-white hover:border-slate-300'}`}
    onClick={onSelect}
    type="button"
  >
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <OpsStatusBadge tone={releaseTone(release.status)}>{humanizeStatus(release.status)}</OpsStatusBadge>
          <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">
            {humanizeStatus(release.targetType)}
          </span>
        </div>
        <h3 className="mt-2 break-words font-semibold text-ops-text">{release.title}</h3>
        <p className="mt-1 break-all font-mono text-xs text-ops-muted">{release.targetKey}</p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-ops-muted">
        v
        {release.version}
      </span>
    </div>
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ops-muted">
      <span>{release.requestedBy.displayName}</span>
      <time dateTime={release.createdAt}>{formatDateTime(release.createdAt)}</time>
    </div>
  </button>
)

const DetailValue = ({ label, value }: { label: string, value: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{label}</dt>
    <dd className="mt-1 break-words text-sm text-ops-text">{value}</dd>
  </div>
)

const OpsConfigurationHistory = () => {
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const filters = useMemo(() => readFilters(new URLSearchParams(paramsKey)), [paramsKey])
  const page = useMemo(() => readPage(new URLSearchParams(paramsKey)), [paramsKey])
  const selectedId = searchParams.get('release')
  const [draft, setDraft] = useState<FilterDraft>(filters)
  const [releases, setReleases] = useState<OpsConfigurationRelease[]>([])
  const [selected, setSelected] = useState<null | OpsConfigurationRelease>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [notice, setNotice] = useState<null | string>(null)
  const [rejectionReason, setRejectionReason] = useState<null | string>(null)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editEffectiveAt, setEditEffectiveAt] = useState('')
  const requestSequence = useRef(0)
  const canManage = Boolean(session?.permissions.includes('configuration:manage'))
  const canApprove = Boolean(session?.permissions.includes('configuration:approve'))

  useEffect(() => setDraft(filters), [filters])

  const load = useCallback(async () => {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setLoading(true)
    setError(null)
    try {
      const response = await listOpsConfigurationReleases({
        page,
        pageSize: PAGE_SIZE,
        query: filters.query || undefined,
        status: filters.status || undefined,
        targetType: filters.targetType || undefined,
      })
      if (requestSequence.current !== sequence) return
      setReleases(response.items)
      setTotal(response.total)
      if (!selectedId) {
        setSelected(response.items[0] ?? null)
        return
      }
      const inPage = response.items.find(item => item.id === selectedId)
      setSelected(inPage ?? await getOpsConfigurationRelease(selectedId))
    }
    catch (loadError) {
      if (requestSequence.current === sequence) {
        setError(loadError instanceof Error ? loadError.message : 'Configuration history could not be loaded')
      }
    }
    finally {
      if (requestSequence.current === sequence) setLoading(false)
    }
  }, [
    filters,
    page,
    selectedId,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const chooseRelease = (releaseId: string): void => {
    const next = new URLSearchParams(searchParams)
    next.set('release', releaseId)
    setSearchParams(next)
  }

  const applyFilters = (): void => {
    const next = new URLSearchParams()
    if (draft.query.trim()) next.set('query', draft.query.trim())
    if (draft.status) next.set('status', draft.status)
    if (draft.targetType) next.set('targetType', draft.targetType)
    setSearchParams(next)
  }

  const clearFilters = (): void => {
    setDraft({ query: '', status: '', targetType: '' })
    setSearchParams(new URLSearchParams())
  }

  const changePage = (nextPage: number): void => {
    const next = new URLSearchParams(searchParams)
    next.delete('release')
    if (nextPage <= 1) next.delete('page')
    else next.set('page', String(nextPage))
    setSearchParams(next)
  }

  const refreshAfterMutation = async (message: string): Promise<void> => {
    setNotice(message)
    await load()
  }

  const runReleaseAction = async (
    action: 'approve' | 'rollback' | 'submit',
  ): Promise<void> => {
    if (!selected) return
    setWorking(true)
    setError(null)
    try {
      await requestMutation({
        action: `configuration.release.${action}`,
        execute: mutation => action === 'approve'
          ? approveOpsConfigurationRelease(selected.id, mutation)
          : action === 'rollback'
            ? createOpsConfigurationRollback(selected.id, mutation)
            : submitOpsConfigurationRelease(selected.id, mutation),
        expectedVersion: selected.version,
        resourceLabel: selected.title,
        title: action === 'approve'
          ? 'Approve configuration release'
          : action === 'rollback'
            ? 'Create rollback draft'
            : 'Submit configuration release',
      })
      await refreshAfterMutation(action === 'rollback'
        ? 'Rollback draft created. Production remains unchanged until a different operator approves it.'
        : action === 'submit'
          ? 'Release submitted for review by a different authorized operator.'
          : 'Release approved. Due changes were applied atomically; scheduled changes remain queued.')
    }
    catch (actionError) {
      if (!isOpsMutationCancelledError(actionError)) {
        setError(actionError instanceof Error ? actionError.message : 'Configuration action failed')
      }
    }
    finally {
      setWorking(false)
    }
  }

  const rejectRelease = async (): Promise<void> => {
    if (!selected || rejectionReason === null) return
    setWorking(true)
    setError(null)
    try {
      await requestMutation({
        action: 'configuration.release.reject',
        execute: mutation => rejectOpsConfigurationRelease(selected.id, rejectionReason, mutation),
        expectedVersion: selected.version,
        resourceLabel: selected.title,
        title: 'Reject configuration release',
      })
      setRejectionReason(null)
      await refreshAfterMutation('Release rejected without changing production configuration.')
    }
    catch (rejectError) {
      if (!isOpsMutationCancelledError(rejectError)) {
        setError(rejectError instanceof Error ? rejectError.message : 'Configuration release could not be rejected')
      }
    }
    finally {
      setWorking(false)
    }
  }

  const openMetadataEditor = (): void => {
    if (!selected) return
    setEditTitle(selected.title)
    setEditEffectiveAt(toLocalDateTime(selected.effectiveAt))
    setEditingMetadata(true)
  }

  const saveMetadata = async (): Promise<void> => {
    if (!selected) return
    setWorking(true)
    setError(null)
    try {
      await requestMutation({
        action: 'configuration.release.update',
        execute: mutation => updateOpsConfigurationRelease(selected.id, {
          effectiveAt: editEffectiveAt ? new Date(editEffectiveAt).toISOString() : undefined,
          payload: selected.payload,
          title: editTitle,
        }, mutation),
        expectedVersion: selected.version,
        resourceLabel: selected.title,
        title: 'Update configuration draft',
      })
      setEditingMetadata(false)
      await refreshAfterMutation('Draft details updated. Production configuration remains unchanged.')
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) {
        setError(saveError instanceof Error ? saveError.message : 'Configuration draft could not be updated')
      }
    }
    finally {
      setWorking(false)
    }
  }

  const ownDraft = selected?.requestedBy.id === session?.userId
  const differentReviewer = selected?.requestedBy.id !== session?.userId
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <OpsPageShell
      actions={<button className="ops-btn-ghost" disabled={loading} onClick={() => void load()} type="button">Refresh</button>}
      error={error}
      eyebrow="Configuration"
      subtitle="Review immutable configuration changes, compare impact, schedule effective times, and safely create rollback drafts."
      title="Release History"
      width="full"
    >
      {notice && <OpsBanner className="mt-5" variant="success">{notice}</OpsBanner>}

      <section aria-labelledby="release-filters-title" className="ops-card mt-6 p-5">
        <div className="flex items-center gap-3">
          <Search aria-hidden className="text-ops-brand" size={20} />
          <div>
            <h2 className="font-semibold text-ops-text" id="release-filters-title">Find a configuration release</h2>
            <p className="text-sm text-ops-muted">Filters apply together and remain shareable in the URL.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <OpsField label="Title or target">
            <input className="ops-input" name="configuration-release-query" onChange={event => setDraft(current => ({ ...current, query: event.target.value }))} placeholder="Search releases" value={draft.query} />
          </OpsField>
          <OpsField label="Release status">
            <select className="ops-input" name="configuration-release-status" onChange={event => setDraft(current => ({ ...current, status: event.target.value as FilterDraft['status'] }))} value={draft.status}>
              <option value="">All statuses</option>
              {opsConfigurationReleaseStatuses.map(status => <option key={status} value={status}>{humanizeStatus(status)}</option>)}
            </select>
          </OpsField>
          <OpsField label="Configuration type">
            <select className="ops-input" name="configuration-release-target" onChange={event => setDraft(current => ({ ...current, targetType: event.target.value as FilterDraft['targetType'] }))} value={draft.targetType}>
              <option value="">All types</option>
              {opsConfigurationTargetTypes.map(targetType => <option key={targetType} value={targetType}>{humanizeStatus(targetType)}</option>)}
            </select>
          </OpsField>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="ops-btn-primary" onClick={applyFilters} type="button">
            <Search aria-hidden size={16} />
            Apply filters
          </button>
          <button className="ops-btn-neutral" onClick={clearFilters} type="button">Clear</button>
        </div>
      </section>

      {loading && releases.length === 0 && <div className="mt-6"><OpsLoading label="Loading configuration releases…" /></div>}
      {!loading && releases.length === 0 && <OpsEmptyState className="mt-6">No configuration releases match this view. Configuration editors create review drafts from the Corridors and Assets pages.</OpsEmptyState>}

      {releases.length > 0 && (
        <div className="mt-6 grid min-w-0 gap-6 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
          <section aria-label="Configuration releases" className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ops-muted">
                {total.toLocaleString('en-US')}
                {' '}
                releases
              </p>
              {totalPages > 1 && <OpsPagination loading={loading} onChange={changePage} page={page} totalPages={totalPages} />}
            </div>
            {releases.map(release => (
              <ReleaseSummary key={release.id} onSelect={() => chooseRelease(release.id)} release={release} selected={selected?.id === release.id} />
            ))}
          </section>

          {selected && (
            <article aria-labelledby="release-detail-title" className="ops-card min-w-0 p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <OpsStatusBadge tone={releaseTone(selected.status)}>{humanizeStatus(selected.status)}</OpsStatusBadge>
                    <span className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{humanizeStatus(selected.targetType)}</span>
                  </div>
                  <h2 className="mt-3 break-words text-xl font-semibold text-ops-text" id="release-detail-title">{selected.title}</h2>
                  <code className="mt-2 block break-all text-xs text-ops-muted">{selected.targetKey}</code>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status === 'DRAFT' && ownDraft && canManage && (
                    <>
                      <button className="ops-btn-neutral" disabled={working} onClick={openMetadataEditor} type="button">
                        <CalendarClock aria-hidden size={16} />
                        Edit draft
                      </button>
                      <button className="ops-btn-primary" disabled={working} onClick={() => void runReleaseAction('submit')} type="button">
                        <Send aria-hidden size={16} />
                        Submit
                      </button>
                    </>
                  )}
                  {selected.status === 'PENDING_APPROVAL' && canApprove && differentReviewer && (
                    <>
                      <button className="ops-btn-danger" disabled={working} onClick={() => setRejectionReason('')} type="button">
                        <XCircle aria-hidden size={16} />
                        Reject
                      </button>
                      <button className="ops-btn-primary" disabled={working} onClick={() => void runReleaseAction('approve')} type="button">
                        <CheckCircle2 aria-hidden size={16} />
                        Approve
                      </button>
                    </>
                  )}
                  {selected.status === 'APPLIED' && canManage && (
                    <button className="ops-btn-neutral" disabled={working} onClick={() => void runReleaseAction('rollback')} type="button">
                      <RotateCcw aria-hidden size={16} />
                      Create rollback
                    </button>
                  )}
                </div>
              </div>

              {selected.status === 'PENDING_APPROVAL' && !differentReviewer && (
                <OpsBanner className="mt-4" variant="info">A different authorized operator must review this release.</OpsBanner>
              )}
              {selected.status === 'APPROVED' && selected.effectiveAt && (
                <OpsBanner className="mt-4" variant="info">
                  Approved and scheduled for
                  {formatDateTime(selected.effectiveAt)}
                  .
                </OpsBanner>
              )}
              {selected.rejectionReason && (
                <OpsBanner className="mt-4" variant="warning">
                  Rejected:
                  {selected.rejectionReason}
                </OpsBanner>
              )}

              <dl className="mt-6 grid gap-4 rounded-2xl border border-ops-border bg-ops-bg p-4 sm:grid-cols-2 xl:grid-cols-3">
                <DetailValue label="Requested by" value={selected.requestedBy.displayName} />
                <DetailValue label="Reviewed by" value={selected.approvedBy?.displayName ?? 'Awaiting review'} />
                <DetailValue label="Effective time" value={selected.effectiveAt ? formatDateTime(selected.effectiveAt) : 'Immediately after approval'} />
                <DetailValue label="Requested" value={formatDateTime(selected.createdAt)} />
                <DetailValue label="Applied" value={selected.appliedAt ? formatDateTime(selected.appliedAt) : 'Not applied'} />
                <DetailValue label="Resource version" value={`Base ${selected.baseVersion}${selected.appliedVersion ? ` → applied ${selected.appliedVersion}` : ''}`} />
              </dl>

              <section aria-labelledby="release-impact-title" className="mt-6">
                <h3 className="flex items-center gap-2 font-semibold text-ops-text" id="release-impact-title">
                  <GitCompareArrows aria-hidden size={18} />
                  Operational impact
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-ops-muted">
                  {selected.impact.map(item => <li className="rounded-xl border border-ops-border bg-amber-50/50 px-4 py-3" key={item}>{item}</li>)}
                </ul>
              </section>

              <section aria-labelledby="release-diff-title" className="mt-6">
                <h3 className="flex items-center gap-2 font-semibold text-ops-text" id="release-diff-title">
                  <History aria-hidden size={18} />
                  Reviewed difference
                </h3>
                {selected.diff.length === 0
                  ? <OpsEmptyState className="mt-3">No effective difference was detected.</OpsEmptyState>
                  : (
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        {selected.diff.map(change => (
                          <div className="min-w-0 rounded-xl border border-ops-border p-4" key={change.field}>
                            <div className="break-all font-mono text-xs font-semibold text-ops-text">{change.field}</div>
                            <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                              <DetailValue label="Before" value={<code className="break-all text-xs">{change.before ?? 'Not set'}</code>} />
                              <DetailValue label="After" value={<code className="break-all text-xs">{change.after ?? 'Not set'}</code>} />
                            </dl>
                          </div>
                        ))}
                      </div>
                    )}
              </section>

              <details className="mt-6 rounded-xl border border-ops-border p-4 text-sm">
                <summary className="cursor-pointer font-semibold text-ops-text">Audit context and raw identifiers</summary>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <DetailValue label="Operational reason" value={selected.reason} />
                  <DetailValue label="Reference" value={selected.reference ?? 'Not provided'} />
                  <DetailValue label="Release ID" value={<code className="break-all text-xs">{selected.id}</code>} />
                  <DetailValue label="Rollback of" value={selected.rollbackOfId ? <Link className="ops-link break-all" to={`/ops/configuration/history?release=${encodeURIComponent(selected.rollbackOfId)}`}>{selected.rollbackOfId}</Link> : 'Not a rollback'} />
                </dl>
              </details>
            </article>
          )}
        </div>
      )}

      {rejectionReason !== null && selected && (
        <OpsDialog description="This records the review decision without changing production configuration." eyebrow="Configuration review" onClose={() => setRejectionReason(null)} title="Explain the rejection">
          <OpsField hint="Use 10–500 characters and do not include customer PII." label="Reviewer rationale">
            <textarea className="ops-input min-h-32" maxLength={500} minLength={10} name="configuration-rejection-reason" onChange={event => setRejectionReason(event.target.value)} value={rejectionReason} />
          </OpsField>
          <div className="mt-5 flex justify-end gap-2">
            <button className="ops-btn-neutral" onClick={() => setRejectionReason(null)} type="button">Cancel</button>
            <button className="ops-btn-danger" disabled={working || rejectionReason.trim().length < 10} onClick={() => void rejectRelease()} type="button">Continue to protected confirmation</button>
          </div>
        </OpsDialog>
      )}

      {editingMetadata && selected && (
        <OpsDialog description="Payload changes stay attached to this draft. Production remains unchanged until approval." eyebrow="Configuration draft" onClose={() => setEditingMetadata(false)} title="Edit release details">
          <div className="grid gap-4">
            <OpsField label="Release title"><input className="ops-input" maxLength={160} minLength={3} name="configuration-release-title" onChange={event => setEditTitle(event.target.value)} value={editTitle} /></OpsField>
            <OpsField hint="Leave empty to apply immediately after approval." label="Effective time"><input className="ops-input" name="configuration-release-effective-at" onChange={event => setEditEffectiveAt(event.target.value)} type="datetime-local" value={editEffectiveAt} /></OpsField>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="ops-btn-neutral" onClick={() => setEditingMetadata(false)} type="button">Cancel</button>
            <button className="ops-btn-primary" disabled={working || editTitle.trim().length < 3} onClick={() => void saveMetadata()} type="button">Continue to protected confirmation</button>
          </div>
        </OpsDialog>
      )}
    </OpsPageShell>
  )
}

export default OpsConfigurationHistory
