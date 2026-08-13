import {
  Eye, Filter, ShieldCheck, UserRoundCheck,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'react-router-dom'

import type {
  OpsKycDetail,
  OpsKycDocumentType,
  OpsKycListFilters,
  OpsKycListResponse,
  OpsKycReviewer,
  OpsKycStatus,
  OpsKycSummary,
} from '../../services/admin/kycAdminTypes'

import {
  assignKycReviewer,
  disableKycUser,
  enableKycUser,
  fetchKycDocument,
  getKycSubmission,
  listKycReviewers,
  listKycSubmissions,
  rejectKyc,
} from '../../services/admin/kycAdminApi'
import { kycStatuses } from '../../services/admin/kycAdminTypes'
import { useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDate,
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
  OpsTone,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

const PAGE_SIZE = 20

const statusTone: Record<OpsKycStatus, OpsTone> = {
  APPROVED: 'success',
  PENDING: 'warning',
  PENDING_APPROVAL: 'info',
  REJECTED: 'danger',
}

const documentTypeLabel: Record<OpsKycDocumentType, string> = {
  DRIVERS_LICENSE: 'Driver\'s license',
  FOREIGN_ID: 'Foreign ID',
  NATIONAL_ID: 'National ID',
  OTHER: 'Other',
  PASSPORT: 'Passport',
}

const documentTypes = Object.keys(documentTypeLabel) as OpsKycDocumentType[]

type DocumentPreview = {
  contentType: string
  url: string
}

type FilterDraft = {
  ageHoursGte: string
  createdFrom: string
  createdTo: string
  documentType: '' | OpsKycDocumentType
  /**
   * Set only by a deep link — following the KYC link on a transaction, say —
   * so it has no filter input; it rides along in the URL until cleared.
   */
  kycId: string
  nationality: string
  partnerId: string
  query: string
  reviewer: string
  status: '' | OpsKycStatus
}

const emptyFilters: FilterDraft = {
  ageHoursGte: '',
  createdFrom: '',
  createdTo: '',
  documentType: '',
  kycId: '',
  nationality: '',
  partnerId: '',
  query: '',
  reviewer: '',
  status: '',
}

const readFilters = (params: URLSearchParams): FilterDraft => ({
  ageHoursGte: params.get('ageHoursGte') ?? '',
  createdFrom: params.get('createdFrom') ?? '',
  createdTo: params.get('createdTo') ?? '',
  documentType: (params.get('documentType') ?? '') as '' | OpsKycDocumentType,
  kycId: params.get('kycId') ?? '',
  nationality: params.get('nationality') ?? '',
  partnerId: params.get('partnerId') ?? '',
  query: params.get('query') ?? '',
  reviewer: params.get('reviewer') ?? '',
  status: (params.get('status') ?? '') as '' | OpsKycStatus,
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

const getAgeLabel = (value: string): string => {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(value))
  const hours = Math.floor(elapsedMs / (60 * 60 * 1_000))
  if (hours < 24) return `${hours}h old`
  return `${Math.floor(hours / 24)}d ${hours % 24}h old`
}

const SensitiveDetail = ({
  detail,
  documentLoading,
  documentPreview,
  onLoadDocument,
}: {
  detail: OpsKycDetail
  documentLoading: boolean
  documentPreview: DocumentPreview | null
  onLoadDocument: () => void
}) => (
  <div className="space-y-5">
    <OpsBanner variant="warning">
      This sensitive-data reveal is recorded in the immutable Ops audit trail.
    </OpsBanner>

    <dl className="grid gap-4 rounded-2xl border border-ops-border bg-ops-bg p-4 sm:grid-cols-2 lg:grid-cols-3">
      {[
        ['Full name', detail.fullName],
        ['Document', detail.documentType ? documentTypeLabel[detail.documentType] : null],
        ['Document number', detail.documentNumber],
        ['Date of birth', detail.dateOfBirth ? formatDate(detail.dateOfBirth) : null],
        ['Nationality', detail.nationality],
        ['Email', detail.email],
        ['Phone', detail.phone],
        ['City', detail.city],
        ['Address', detail.address],
      ].map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">{label}</dt>
          <dd className="mt-1 break-words text-sm text-ops-text">{value || '—'}</dd>
        </div>
      ))}
    </dl>

    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Partner</dt>
        <dd className="mt-1 text-ops-text">{detail.partnerName}</dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Submitted</dt>
        <dd className="mt-1 text-ops-text">{formatDateTime(detail.submittedAt)}</dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Partner user ID</dt>
        <dd className="mt-1 break-all font-mono text-xs text-ops-text">{detail.partnerUserId}</dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">External user ID</dt>
        <dd className="mt-1 break-all font-mono text-xs text-ops-text">{detail.userId}</dd>
      </div>
    </dl>

    <section aria-labelledby="identity-document" className="rounded-2xl border border-ops-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-ops-text" id="identity-document">Identity document</h3>
          <p className="mt-1 text-sm text-ops-muted">Document bytes remain private and are fetched only after this second deliberate action.</p>
        </div>
        <button
          className="ops-btn-primary shrink-0"
          disabled={!detail.hasDocument || documentLoading || Boolean(documentPreview)}
          onClick={onLoadDocument}
          type="button"
        >
          <Eye aria-hidden size={16} />
          {documentLoading ? 'Loading document…' : documentPreview ? 'Document loaded' : 'Load identity document'}
        </button>
      </div>

      {documentPreview && (
        <div className="mt-4 overflow-hidden rounded-xl border border-ops-border bg-white">
          {documentPreview.contentType === 'application/pdf'
            ? <iframe className="h-[60vh] w-full" src={documentPreview.url} title="Identity document" />
            : (
                <div className="max-h-[60vh] overflow-auto p-4">
                  <img alt="Identity document" className="mx-auto max-h-[56vh] w-auto" src={documentPreview.url} />
                </div>
              )}
        </div>
      )}
    </section>
  </div>
)

const KycSubmissions = () => {
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryString = searchParams.toString()
  const appliedFilters = useMemo(() => readFilters(new URLSearchParams(queryString)), [queryString])
  const page = useMemo(() => readPage(new URLSearchParams(queryString)), [queryString])
  const [draft, setDraft] = useState<FilterDraft>(appliedFilters)
  const [data, setData] = useState<null | OpsKycListResponse>(null)
  const [reviewers, setReviewers] = useState<OpsKycReviewer[]>([])
  const [reviewerDrafts, setReviewerDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [actionLoading, setActionLoading] = useState<null | string>(null)
  const [detail, setDetail] = useState<null | OpsKycDetail>(null)
  const [detailLoadingId, setDetailLoadingId] = useState<null | string>(null)
  const [documentLoading, setDocumentLoading] = useState(false)
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null)
  const requestSequence = useRef(0)
  const canRead = Boolean(session?.permissions.includes('kyc:read'))
  const canReveal = Boolean(session?.permissions.includes('kyc:reveal'))
  const canDecide = Boolean(session?.permissions.includes('kyc:decide'))

  useEffect(() => {
    setDraft(appliedFilters)
  }, [appliedFilters])

  const load = useCallback(async () => {
    if (!canRead) {
      setData(null)
      return
    }
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    const filters: OpsKycListFilters = {
      ageHoursGte: appliedFilters.ageHoursGte ? Number(appliedFilters.ageHoursGte) : undefined,
      createdFrom: toIsoDate(appliedFilters.createdFrom),
      createdTo: toIsoDate(appliedFilters.createdTo),
      documentType: appliedFilters.documentType || undefined,
      kycId: appliedFilters.kycId || undefined,
      nationality: appliedFilters.nationality || undefined,
      page,
      pageSize: PAGE_SIZE,
      partnerId: appliedFilters.partnerId || undefined,
      query: appliedFilters.query || undefined,
      reviewer: appliedFilters.reviewer || undefined,
      status: appliedFilters.status || undefined,
    }
    setLoading(true)
    setError(null)
    try {
      const result = await listKycSubmissions(filters)
      if (requestSequence.current !== sequence) return
      setData(result)
      setReviewerDrafts(Object.fromEntries(result.items.map(item => [item.id, item.reviewer?.id ?? ''])))
    }
    catch (loadError) {
      if (requestSequence.current !== sequence) return
      setError(loadError instanceof Error ? loadError.message : 'Failed to load KYC review queue')
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

  useEffect(() => {
    if (!canRead) {
      setReviewers([])
      return
    }
    let active = true
    void listKycReviewers()
      .then((items) => {
        if (active) setReviewers(items)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Failed to load reviewer options')
      })
    return () => {
      active = false
    }
  }, [canRead])

  useEffect(() => () => {
    if (documentPreview) URL.revokeObjectURL(documentPreview.url)
  }, [documentPreview])

  const applyUserState = useCallback((partnerUserId: string, disabledAt: null | string) => {
    setData(current => current
      ? {
          ...current,
          items: current.items.map(item => item.partnerUserId === partnerUserId
            ? { ...item, disabledAt }
            : item),
        }
      : current)
  }, [])

  const closeDetail = (): void => {
    setDetail(null)
    setDocumentPreview((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
  }

  const handleReveal = async (kycId: string): Promise<void> => {
    setDetailLoadingId(kycId)
    setError(null)
    try {
      setDetail(await getKycSubmission(kycId))
    }
    catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : 'Failed to reveal KYC details')
    }
    finally {
      setDetailLoadingId(null)
    }
  }

  const handleLoadDocument = async (): Promise<void> => {
    if (!detail) return
    setDocumentLoading(true)
    setError(null)
    try {
      const result = await fetchKycDocument(detail.id)
      setDocumentPreview((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { contentType: result.contentType, url: result.objectUrl }
      })
    }
    catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : 'Failed to load document')
    }
    finally {
      setDocumentLoading(false)
    }
  }

  const handleAssignment = async (item: OpsKycSummary): Promise<void> => {
    const reviewerUserId = reviewerDrafts[item.id] || null
    if (reviewerUserId === (item.reviewer?.id ?? null)) return
    setActionLoading(`assignment:${item.id}`)
    setError(null)
    try {
      const assignment = await requestMutation({
        action: 'kyc.submission.assign',
        execute: mutation => assignKycReviewer(item.id, reviewerUserId, mutation),
        expectedVersion: item.version,
        resourceLabel: `${item.partnerName} · ${item.fullNameMasked ?? 'masked identity'}`,
        title: 'Assign KYC review',
      })
      setData(current => current
        ? {
            ...current,
            items: current.items.map(candidate => candidate.id === item.id
              ? { ...candidate, reviewer: assignment.reviewer, version: assignment.version }
              : candidate),
          }
        : current)
    }
    catch (assignmentError) {
      if (isOpsMutationCancelledError(assignmentError)) return
      setError(assignmentError instanceof Error ? assignmentError.message : 'Failed to assign review')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleToggleDisabled = async (item: OpsKycSummary): Promise<void> => {
    const isDisabled = Boolean(item.disabledAt)
    setActionLoading(`toggle:${item.id}`)
    setError(null)
    try {
      const result = await requestMutation({
        action: isDisabled ? 'kyc.user.enable' : 'kyc.user.disable',
        execute: mutation => isDisabled
          ? enableKycUser(item.partnerUserId, mutation)
          : disableKycUser(item.partnerUserId, mutation.reason, mutation),
        resourceLabel: `${item.partnerName} · ${item.fullNameMasked ?? 'masked identity'}`,
        title: isDisabled ? 'Enable user activity' : 'Disable user activity',
      })
      applyUserState(item.partnerUserId, result.disabledAt)
    }
    catch (toggleError) {
      if (isOpsMutationCancelledError(toggleError)) return
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update user')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (item: OpsKycSummary): Promise<void> => {
    setActionLoading(`reject:${item.id}`)
    setError(null)
    try {
      await requestMutation({
        action: 'kyc.submission.reject',
        execute: mutation => rejectKyc(item.id, mutation),
        resourceLabel: `${item.partnerName} · ${item.fullNameMasked ?? 'masked identity'}`,
        title: 'Reject KYC submission',
      })
      setData(current => current
        ? {
            ...current,
            items: current.items.map(candidate => candidate.id === item.id
              ? { ...candidate, status: 'REJECTED' as const }
              : candidate),
          }
        : current)
    }
    catch (rejectError) {
      if (isOpsMutationCancelledError(rejectError)) return
      setError(rejectError instanceof Error ? rejectError.message : 'Failed to reject submission')
    }
    finally {
      setActionLoading(null)
    }
  }

  const applyFilters = (): void => {
    const next = new URLSearchParams()
    Object.entries(draft).forEach(([key, value]) => {
      const normalized = value.trim()
      if (normalized) next.set(key, normalized)
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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const hasAppliedFilters = Object.values(appliedFilters).some(Boolean)

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost" disabled={!canRead || loading} onClick={() => void load()} type="button">
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Partners & Compliance"
      keyRequiredMessage="A named compliance or administrator session is required to load KYC reviews."
      subtitle="Triage masked submissions, assign ownership, and reveal identity evidence only when review requires it."
      title="KYC Review Queue"
      width="full"
    >
      {session && !canRead && (
        <OpsBanner className="mt-6" variant="warning">
          Your role does not include compliance review access.
        </OpsBanner>
      )}

      {canRead && appliedFilters.kycId && (
        <OpsBanner className="mt-6" variant="info">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Showing one linked submission rather than the review queue.
            <button className="font-semibold underline" onClick={clearFilters} type="button">
              Return to the full queue
            </button>
          </span>
        </OpsBanner>
      )}

      {canRead && (
        <>
          <section aria-labelledby="kyc-filter-title" className="ops-card mt-8 p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-ops-brand/10 text-ops-brand">
                <Filter aria-hidden size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ops-text" id="kyc-filter-title">Find review work</h2>
                <p className="mt-1 text-sm text-ops-muted">Draft filters apply only when requested and remain in the URL for handoff.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <OpsField hint="Searches submitted name, email, document number, or partner user ID; results stay masked." label="User or document search">
                <input
                  autoComplete="off"
                  className="ops-input"
                  name="kyc-query"
                  onChange={event => setDraft(current => ({ ...current, query: event.target.value }))}
                  value={draft.query}
                />
              </OpsField>
              <OpsField label="Partner ID">
                <input
                  autoComplete="off"
                  className="ops-input font-mono"
                  name="kyc-partner-id"
                  onChange={event => setDraft(current => ({ ...current, partnerId: event.target.value }))}
                  value={draft.partnerId}
                />
              </OpsField>
              <OpsField label="Decision / status">
                <select
                  className="ops-input"
                  name="kyc-status"
                  onChange={event => setDraft(current => ({ ...current, status: event.target.value as '' | OpsKycStatus }))}
                  value={draft.status}
                >
                  <option value="">All decisions</option>
                  {kycStatuses.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </OpsField>
              <OpsField label="Review owner">
                <select
                  className="ops-input"
                  name="kyc-reviewer"
                  onChange={event => setDraft(current => ({ ...current, reviewer: event.target.value }))}
                  value={draft.reviewer}
                >
                  <option value="">Any owner</option>
                  <option value="UNASSIGNED">Unassigned</option>
                  {reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName}</option>)}
                </select>
              </OpsField>
              <OpsField label="Country code">
                <input
                  autoComplete="country"
                  className="ops-input uppercase"
                  maxLength={3}
                  name="kyc-nationality"
                  onChange={event => setDraft(current => ({ ...current, nationality: event.target.value.toUpperCase() }))}
                  value={draft.nationality}
                />
              </OpsField>
              <OpsField label="Document type">
                <select
                  className="ops-input"
                  name="kyc-document-type"
                  onChange={event => setDraft(current => ({ ...current, documentType: event.target.value as '' | OpsKycDocumentType }))}
                  value={draft.documentType}
                >
                  <option value="">All document types</option>
                  {documentTypes.map(type => <option key={type} value={type}>{documentTypeLabel[type]}</option>)}
                </select>
              </OpsField>
              <OpsField label="Submitted from">
                <input
                  className="ops-input"
                  name="kyc-created-from"
                  onChange={event => setDraft(current => ({ ...current, createdFrom: event.target.value }))}
                  type="datetime-local"
                  value={draft.createdFrom}
                />
              </OpsField>
              <OpsField label="Submitted to">
                <input
                  className="ops-input"
                  name="kyc-created-to"
                  onChange={event => setDraft(current => ({ ...current, createdTo: event.target.value }))}
                  type="datetime-local"
                  value={draft.createdTo}
                />
              </OpsField>
              <OpsField label="Minimum age / SLA">
                <select
                  className="ops-input"
                  name="kyc-age-hours"
                  onChange={event => setDraft(current => ({ ...current, ageHoursGte: event.target.value }))}
                  value={draft.ageHoursGte}
                >
                  <option value="">Any age</option>
                  <option value="24">24 hours or older</option>
                  <option value="48">48 hours or older</option>
                  <option value="72">3 days or older</option>
                  <option value="168">7 days or older</option>
                </select>
              </OpsField>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="ops-btn-primary" onClick={applyFilters} type="button">Apply filters</button>
              <button className="ops-btn-neutral" disabled={!hasAppliedFilters} onClick={clearFilters} type="button">Clear filters</button>
            </div>
          </section>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-ops-text">Identity review work</h2>
              <p className="text-sm text-ops-muted">
                {data ? data.total.toLocaleString('en-US') : '—'}
                {' '}
                submissions · sensitive values masked by default
              </p>
            </div>
            <OpsPagination loading={loading} onChange={changePage} page={page} totalPages={totalPages} />
          </div>

          {loading && !data && <div className="mt-5"><OpsLoading label="Loading KYC review work…" /></div>}
          {!loading && data?.items.length === 0 && (
            <OpsEmptyState
              action={hasAppliedFilters
                ? <button className="ops-btn-neutral" onClick={clearFilters} type="button">Clear filters</button>
                : undefined}
              className="mt-5"
            >
              {hasAppliedFilters ? 'No KYC reviews match these filters.' : 'No KYC reviews are waiting.'}
            </OpsEmptyState>
          )}

          {data && data.items.length > 0 && (
            <section aria-label="KYC review queue" className="mt-5 grid gap-4 xl:grid-cols-2">
              {loading && <OpsBanner className="xl:col-span-2" variant="info">Refreshing the review queue…</OpsBanner>}
              {data.items.map((item) => {
                const isDisabled = Boolean(item.disabledAt)
                const busy = actionLoading?.endsWith(item.id) ?? false
                const reviewerDraft = reviewerDrafts[item.id] ?? item.reviewer?.id ?? ''
                return (
                  <article className="ops-card min-w-0 p-5" key={item.id}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <OpsStatusBadge label={humanizeStatus(item.status)} tone={statusTone[item.status]} />
                          <OpsStatusBadge tone={isDisabled ? 'danger' : 'success'}>
                            {isDisabled ? 'User disabled' : 'User active'}
                          </OpsStatusBadge>
                        </div>
                        <h2 className="mt-3 break-words text-lg font-semibold text-ops-text">
                          {item.fullNameMasked ?? 'Masked identity'}
                        </h2>
                        <div className="mt-1 text-sm text-ops-muted">{item.partnerName}</div>
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Document</dt>
                            <dd className="mt-1 text-ops-text">
                              {item.documentType ? documentTypeLabel[item.documentType] : 'Document'}
                              {' · '}
                              {item.documentNumberMasked ?? 'masked'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Contact</dt>
                            <dd className="mt-1 break-all text-ops-text">{item.emailMasked ?? 'masked'}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Submitted</dt>
                            <dd className="mt-1 text-ops-text">
                              {formatDateTime(item.submittedAt)}
                              {' '}
                              ·
                              {' '}
                              {getAgeLabel(item.submittedAt)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wide text-ops-muted">Country</dt>
                            <dd className="mt-1 text-ops-text">{item.nationality ?? '—'}</dd>
                          </div>
                        </dl>
                      </div>
                      <ShieldCheck aria-hidden className="shrink-0 text-ops-brand" size={24} />
                    </div>

                    <div className="mt-5 rounded-2xl border border-ops-border bg-ops-bg p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-ops-text">
                        <UserRoundCheck aria-hidden size={17} />
                        Review ownership
                      </div>
                      {canDecide
                        ? (
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <select
                                aria-label={`Review owner for ${item.fullNameMasked ?? item.id}`}
                                className="ops-input min-w-0 flex-1"
                                disabled={busy}
                                onChange={event => setReviewerDrafts(current => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))}
                                value={reviewerDraft}
                              >
                                <option value="">Unassigned</option>
                                {reviewers.map(reviewer => (
                                  <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName}</option>
                                ))}
                              </select>
                              <button
                                className="ops-btn-primary ops-btn-sm"
                                disabled={busy || reviewerDraft === (item.reviewer?.id ?? '')}
                                onClick={() => void handleAssignment(item)}
                                type="button"
                              >
                                Assign
                              </button>
                            </div>
                          )
                        : <p className="mt-2 text-sm text-ops-muted">{item.reviewer?.displayName ?? 'Unassigned'}</p>}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="ops-btn-neutral ops-btn-sm"
                        disabled={!canReveal || detailLoadingId === item.id}
                        onClick={() => void handleReveal(item.id)}
                        type="button"
                      >
                        <Eye aria-hidden size={15} />
                        {detailLoadingId === item.id ? 'Revealing…' : 'Reveal sensitive details'}
                      </button>
                      {canDecide && (
                        <button
                          className={isDisabled ? 'ops-btn-primary ops-btn-sm' : 'ops-btn-danger ops-btn-sm'}
                          disabled={busy}
                          onClick={() => void handleToggleDisabled(item)}
                          type="button"
                        >
                          {isDisabled ? 'Enable user' : 'Disable user'}
                        </button>
                      )}
                      {canDecide && item.status === 'APPROVED' && (
                        <button
                          className="ops-btn-ghost ops-btn-sm"
                          disabled={busy}
                          onClick={() => void handleReject(item)}
                          type="button"
                        >
                          Reject decision
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </section>
          )}
        </>
      )}

      {detail && (
        <OpsDialog
          description={`${detail.partnerName} · opened only for the current review task`}
          eyebrow="Audited sensitive reveal"
          onClose={closeDetail}
          size="xl"
          title="Identity evidence"
        >
          <SensitiveDetail
            detail={detail}
            documentLoading={documentLoading}
            documentPreview={documentPreview}
            onLoadDocument={() => void handleLoadDocument()}
          />
        </OpsDialog>
      )}
    </OpsPageShell>
  )
}

export default KycSubmissions
