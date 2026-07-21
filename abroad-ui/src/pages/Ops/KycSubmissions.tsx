import {
  useCallback, useEffect, useMemo, useState,
} from 'react'

import {
  disableKycUser,
  enableKycUser,
  fetchKycDocument,
  listKycSubmissions,
  rejectKyc,
} from '../../services/admin/kycAdminApi'
import {
  kycStatuses,
  OpsKycDocumentType,
  OpsKycListResponse,
  OpsKycStatus,
} from '../../services/admin/kycAdminTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatDate,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
  OpsTone,
} from './shared'

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

type DocumentPreview = { contentType: string, kycId: string, url: string }

const KycSubmissions = () => {
  const [data, setData] = useState<null | OpsKycListResponse>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [status, setStatus] = useState<'' | OpsKycStatus>('')
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<null | string>(null)
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [previewLoadingId, setPreviewLoadingId] = useState<null | string>(null)
  const pageSize = 20
  const opsApiKey = useOpsApiKey()

  const query = useMemo(() => ({ page, pageSize, status: status || undefined }), [page, status])

  const fetchData = useCallback(async () => {
    if (!opsApiKey) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await listKycSubmissions(query)
      setData(result)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load KYC submissions')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey, query])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // Revoke the object URL when the preview changes or the component unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url)
    }
  }, [preview])

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
  }, [])

  const handleViewDocument = useCallback(async (kycId: string) => {
    setError(null)
    setPreviewLoadingId(kycId)
    try {
      const result = await fetchKycDocument(kycId)
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url)
        return { contentType: result.contentType, kycId, url: result.objectUrl }
      })
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load document')
    }
    finally {
      setPreviewLoadingId(null)
    }
  }, [])

  const applyUserState = useCallback((partnerUserId: string, disabledAt: null | string) => {
    setData(current => current
      ? {
          ...current,
          items: current.items.map(item =>
            item.partnerUserId === partnerUserId ? { ...item, disabledAt } : item),
        }
      : current)
  }, [])

  const handleToggleDisabled = useCallback(async (partnerUserId: string, isDisabled: boolean) => {
    const confirmed = window.confirm(
      isDisabled
        ? 'Re-enable this user? They will be able to transact again.'
        : 'Disable this user? They will be blocked from all actions.',
    )
    if (!confirmed) return

    setActionLoading(`toggle:${partnerUserId}`)
    setError(null)
    try {
      const result = isDisabled
        ? await enableKycUser(partnerUserId)
        : await disableKycUser(partnerUserId)
      applyUserState(partnerUserId, result.disabledAt)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
    finally {
      setActionLoading(null)
    }
  }, [applyUserState])

  const handleReject = useCallback(async (kycId: string) => {
    if (!window.confirm('Reject this KYC submission? The user will need to submit again.')) return
    setActionLoading(`reject:${kycId}`)
    setError(null)
    try {
      await rejectKyc(kycId)
      setData(current => current
        ? {
            ...current,
            items: current.items.map(item =>
              item.id === kycId ? { ...item, status: 'REJECTED' as const } : item),
          }
        : current)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject submission')
    }
    finally {
      setActionLoading(null)
    }
  }, [])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey}
          onClick={() => void fetchData()}
          type="button"
        >
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Operations"
      keyRequiredMessage="Ops API key required to load KYC submissions."
      subtitle="Review completed KYC submissions, view documents, and disable users."
      title="KYC"
    >
      <div className="ops-card mt-8 grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
        <OpsField label="Status">
          <select
            className="ops-input"
            onChange={event => setStatus(event.target.value as '' | OpsKycStatus)}
            value={status}
          >
            <option value="">All</option>
            {kycStatuses.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </OpsField>
        <div className="flex items-end">
          <button className="ops-btn-primary w-full" onClick={() => setPage(1)} type="button">
            Apply
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-xs text-ops-muted">
          {data ? `${data.total} submission${data.total === 1 ? '' : 's'}` : ''}
        </div>
        <OpsPagination loading={loading} onChange={setPage} page={page} totalPages={totalPages} />
      </div>

      <div className="mt-4 space-y-3">
        {loading && opsApiKey && <OpsLoading label="Loading KYC submissions…" />}

        {!loading && opsApiKey && data?.items.length === 0 && (
          <OpsEmptyState>No KYC submissions match the current filters.</OpsEmptyState>
        )}

        {data?.items.map((item) => {
          const isDisabled = Boolean(item.disabledAt)
          const busy = actionLoading === `toggle:${item.partnerUserId}`
          const rejecting = actionLoading === `reject:${item.id}`
          return (
            <div className="ops-card px-6 py-4" key={item.id}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <OpsStatusBadge label={item.status} tone={statusTone[item.status]} />
                    <OpsStatusBadge tone={isDisabled ? 'danger' : 'success'}>
                      {isDisabled ? 'Disabled' : 'Active'}
                    </OpsStatusBadge>
                  </div>
                  <div className="mt-2 text-sm font-semibold break-words">
                    {item.fullName ?? '—'}
                  </div>
                  <div className="mt-1 text-xs text-ops-muted">
                    {item.documentType ? documentTypeLabel[item.documentType] : 'Document'}
                    {' · '}
                    {item.documentNumber ?? '—'}
                  </div>
                  <div className="mt-1 text-xs text-ops-muted break-words">
                    {[item.email, item.phone].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className="mt-1 text-xs text-ops-muted break-words">
                    {[
                      item.nationality,
                      item.city,
                      item.address,
                    ].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className="mt-1 text-xs text-ops-muted">
                    {'Born '}
                    {item.dateOfBirth ? formatDate(item.dateOfBirth) : '—'}
                    {' · Submitted '}
                    {formatDate(item.submittedAt)}
                    {' · '}
                    {item.partnerName}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 md:flex-col md:items-end">
                  <button
                    className="ops-btn-neutral ops-btn-sm"
                    disabled={!item.hasDocument || previewLoadingId === item.id}
                    onClick={() => void handleViewDocument(item.id)}
                    type="button"
                  >
                    {previewLoadingId === item.id ? 'Loading…' : 'View document'}
                  </button>
                  <button
                    className={isDisabled ? 'ops-btn-primary ops-btn-sm' : 'ops-btn-danger ops-btn-sm'}
                    disabled={busy}
                    onClick={() => void handleToggleDisabled(item.partnerUserId, isDisabled)}
                    type="button"
                  >
                    {busy ? 'Saving…' : isDisabled ? 'Enable user' : 'Disable user'}
                  </button>
                  {item.status === 'APPROVED' && (
                    <button
                      className="ops-btn-ghost ops-btn-sm"
                      disabled={rejecting}
                      onClick={() => void handleReject(item.id)}
                      type="button"
                    >
                      {rejecting ? 'Rejecting…' : 'Reject'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closePreview}
          role="presentation"
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white"
            onClick={event => event.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center justify-between border-b border-ops-border px-4 py-2">
              <span className="text-sm font-medium text-ops-text">Identity document</span>
              <button className="ops-btn-ghost ops-btn-sm" onClick={closePreview} type="button">
                Close
              </button>
            </div>
            {preview.contentType === 'application/pdf'
              ? <iframe className="h-[80vh] w-full" src={preview.url} title="Identity document" />
              : (
                  <div className="overflow-auto p-4">
                    <img alt="Identity document" className="mx-auto max-h-[80vh] w-auto" src={preview.url} />
                  </div>
                )}
          </div>
        </div>
      )}
    </OpsPageShell>
  )
}

export default KycSubmissions
