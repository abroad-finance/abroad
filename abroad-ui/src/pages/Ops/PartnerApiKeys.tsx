import {
  useCallback, useEffect, useMemo, useState,
} from 'react'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  createPartner,
  listPartners,
  revokePartnerApiKey,
  rotatePartnerApiKey,
  updatePartnerClientDomain,
} from '../../services/admin/partnerAdminApi'
import {
  OpsCreatePartnerInput,
  OpsPartner,
  OpsPartnerCompletedVolume,
  OpsPartnerListItem,
} from '../../services/admin/partnerTypes'
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
} from './shared'

const pageSize = 20

type CreatePartnerDraft = {
  clientDomain: string
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone: string
}

type RevealedKey = {
  action: 'created' | 'rotated'
  apiKey: string
  partnerId: string
  partnerName: string
}

const emptyDraft: CreatePartnerDraft = {
  clientDomain: '',
  company: '',
  country: 'CO',
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
}

const validateDraft = (draft: CreatePartnerDraft): null | string => {
  if (!draft.company.trim()) return 'Company is required.'
  if (!draft.country.trim()) return 'Country is required.'
  if (!draft.firstName.trim()) return 'First name is required.'
  if (!draft.lastName.trim()) return 'Last name is required.'
  if (!draft.email.trim()) return 'Email is required.'
  if (!draft.email.includes('@')) return 'Email format is invalid.'
  return null
}

const buildActionKey = (
  action: 'clear-domain' | 'revoke' | 'rotate' | 'save-domain',
  partnerId: string,
): string => `${action}:${partnerId}`

const CompletedVolume = ({ volume }: { volume: OpsPartnerCompletedVolume }) => {
  const transactionLabel = volume.completedTransactions === 1 ? 'transaction' : 'transactions'

  if (volume.completedTransactions === 0) {
    return (
      <div className="min-w-[180px] text-xs text-ops-muted">
        No completed volume
      </div>
    )
  }

  const source = volume.source
    .map(item => `${formatAmount(item.amount)} ${item.currency}`)
    .join(' · ')
  const payout = volume.payout
    .map(item => formatMoney(item.amount, item.currency))
    .join(' · ')

  return (
    <div className="min-w-[180px] space-y-1.5">
      <div className="font-semibold text-ops-text">
        {volume.completedTransactions.toLocaleString('en-US')}
        {' '}
        completed
        {' '}
        {transactionLabel}
      </div>
      <div className="text-xs leading-relaxed text-ops-muted">
        <span className="font-medium text-ops-text">Received</span>
        {' '}
        {source || '—'}
      </div>
      <div className="text-xs leading-relaxed text-ops-muted">
        <span className="font-medium text-ops-text">Paid out</span>
        {' '}
        {payout || '—'}
      </div>
    </div>
  )
}

const PartnerApiKeys = () => {
  const opsApiKey = useOpsApiKey()
  const [partners, setPartners] = useState<OpsPartnerListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [actionLoading, setActionLoading] = useState<null | string>(null)
  const [editingPartnerId, setEditingPartnerId] = useState<null | string>(null)
  const [editingClientDomain, setEditingClientDomain] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [draft, setDraft] = useState<CreatePartnerDraft>(emptyDraft)
  const [revealedKey, setRevealedKey] = useState<null | RevealedKey>(null)
  const [copied, setCopied] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total])

  const loadPartners = useCallback(async (targetPage: number = page) => {
    if (!opsApiKey) {
      setPartners([])
      setTotal(0)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await listPartners({ page: targetPage, pageSize })
      setPartners(response.items)
      setTotal(response.total)
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load partners')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey, page])

  useEffect(() => {
    void loadPartners()
  }, [loadPartners])

  useEffect(() => {
    if (!copied) return undefined
    const timeout = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const createPayload = (): OpsCreatePartnerInput => ({
    clientDomain: draft.clientDomain.trim() || undefined,
    company: draft.company.trim(),
    country: draft.country.trim(),
    email: draft.email.trim(),
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    phone: draft.phone.trim() || undefined,
  })

  const updatePartnerRecord = useCallback((nextPartner: OpsPartner) => {
    setPartners(current => current.map(item => (
      item.id === nextPartner.id
        ? { ...item, ...nextPartner, clientDomain: nextPartner.clientDomain }
        : item
    )))
  }, [])

  const isPartnerBusy = useCallback((partnerId: string): boolean => (
    actionLoading?.endsWith(`:${partnerId}`) ?? false
  ), [actionLoading])

  const handleCreatePartner = async () => {
    const validationError = validateDraft(draft)
    if (validationError) {
      setError(validationError)
      return
    }

    setCreating(true)
    setError(null)
    try {
      const response = await createPartner(createPayload())
      setRevealedKey({
        action: 'created',
        apiKey: response.apiKey,
        partnerId: response.partner.id,
        partnerName: response.partner.name,
      })
      setDraft(emptyDraft)
      setPage(1)
      await loadPartners(1)
    }
    catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create partner')
    }
    finally {
      setCreating(false)
    }
  }

  const handleRotate = async (partner: OpsPartner) => {
    const key = buildActionKey('rotate', partner.id)
    setActionLoading(key)
    setError(null)

    try {
      const response = await rotatePartnerApiKey(partner.id)
      updatePartnerRecord(response.partner)
      setRevealedKey({
        action: 'rotated',
        apiKey: response.apiKey,
        partnerId: response.partner.id,
        partnerName: response.partner.name,
      })
    }
    catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : 'Failed to rotate API key')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleRevoke = async (partner: OpsPartner) => {
    const confirmed = window.confirm(`Revoke API key for ${partner.name}?`)
    if (!confirmed) return

    const key = buildActionKey('revoke', partner.id)
    setActionLoading(key)
    setError(null)

    try {
      await revokePartnerApiKey(partner.id)
      setPartners(current => current.map(item => (
        item.id === partner.id
          ? { ...item, hasApiKey: false }
          : item
      )))
      if (revealedKey?.partnerId === partner.id) {
        setRevealedKey(null)
      }
    }
    catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke API key')
    }
    finally {
      setActionLoading(null)
    }
  }

  const startEditingClientDomain = useCallback((partner: OpsPartner) => {
    setEditingPartnerId(partner.id)
    setEditingClientDomain(partner.clientDomain ?? '')
    setError(null)
  }, [])

  const stopEditingClientDomain = useCallback(() => {
    setEditingPartnerId(null)
    setEditingClientDomain('')
  }, [])

  const handleSaveClientDomain = async (partner: OpsPartner) => {
    const key = buildActionKey('save-domain', partner.id)
    setActionLoading(key)
    setError(null)

    try {
      const updatedPartner = await updatePartnerClientDomain(partner.id, {
        clientDomain: editingClientDomain.trim() || null,
      })
      updatePartnerRecord(updatedPartner)
      stopEditingClientDomain()
    }
    catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save client domain')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleClearClientDomain = async (partner: OpsPartner) => {
    const confirmed = window.confirm(`Clear client domain for ${partner.name}?`)
    if (!confirmed) return

    const key = buildActionKey('clear-domain', partner.id)
    setActionLoading(key)
    setError(null)

    try {
      const updatedPartner = await updatePartnerClientDomain(partner.id, { clientDomain: null })
      updatePartnerRecord(updatedPartner)
      if (editingPartnerId === partner.id) {
        stopEditingClientDomain()
      }
    }
    catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'Failed to clear client domain')
    }
    finally {
      setActionLoading(null)
    }
  }

  const copyKey = async () => {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey.apiKey)
      setCopied(true)
    }
    catch {
      setError('Failed to copy API key. Copy it manually from the field.')
    }
  }

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey || loading}
          onClick={() => void loadPartners()}
          type="button"
        >
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Operations"
      keyRequiredMessage="Ops API key required to manage partners."
      subtitle="Track completed volume by partner, create accounts, manage trusted browser domains, and control API-key access."
      title="Partners & API Keys"
      width="full"
    >
      {revealedKey && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.35)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-amber-700">One-Time API Key</div>
              <div className="mt-1 text-sm text-amber-900">
                Partner
                {' '}
                <span className="font-semibold">{revealedKey.partnerName}</span>
                {' '}
                API key was
                {' '}
                <span className="font-semibold">{revealedKey.action === 'created' ? 'created' : 'rotated'}</span>
                .
                Store it now, this value will not be shown again.
              </div>
            </div>
            <button
              className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 transition"
              onClick={() => setRevealedKey(null)}
              type="button"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <code className="flex-1 break-all rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900">
              {revealedKey.apiKey}
            </code>
            <button
              className="rounded-xl border border-amber-400 bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition"
              onClick={() => void copyKey()}
              type="button"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="ops-card p-5">
          <div className="ops-label">Create Partner</div>
          <h2 className="mt-2 text-xl font-semibold">Onboard New Partner</h2>
          <div className="mt-4 grid grid-cols-1 gap-3">
            <OpsField label="Company">
              <input
                className="ops-input"
                onChange={event => setDraft(current => ({ ...current, company: event.target.value }))}
                value={draft.company}
              />
            </OpsField>
            <div className="grid grid-cols-2 gap-3">
              <OpsField label="Country">
                <input
                  className="ops-input"
                  onChange={event => setDraft(current => ({ ...current, country: event.target.value }))}
                  value={draft.country}
                />
              </OpsField>
              <OpsField label="Phone">
                <input
                  className="ops-input"
                  onChange={event => setDraft(current => ({ ...current, phone: event.target.value }))}
                  placeholder="Optional"
                  value={draft.phone}
                />
              </OpsField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OpsField label="First name">
                <input
                  className="ops-input"
                  onChange={event => setDraft(current => ({ ...current, firstName: event.target.value }))}
                  value={draft.firstName}
                />
              </OpsField>
              <OpsField label="Last name">
                <input
                  className="ops-input"
                  onChange={event => setDraft(current => ({ ...current, lastName: event.target.value }))}
                  value={draft.lastName}
                />
              </OpsField>
            </div>
            <OpsField label="Email">
              <input
                className="ops-input"
                onChange={event => setDraft(current => ({ ...current, email: event.target.value }))}
                type="email"
                value={draft.email}
              />
            </OpsField>
            <OpsField
              hint={(
                <>
                  Enter a hostname like
                  {' '}
                  <span className="font-medium">app.example.com</span>
                  {' '}
                  or a full URL. Abroad will store the canonical host only.
                </>
              )}
              label="Client domain"
            >
              <input
                className="ops-input"
                onChange={event => setDraft(current => ({ ...current, clientDomain: event.target.value }))}
                placeholder="Optional"
                type="text"
                value={draft.clientDomain}
              />
            </OpsField>
            <button
              className="ops-btn-primary mt-1"
              disabled={!opsApiKey || creating}
              onClick={() => void handleCreatePartner()}
              type="button"
            >
              {creating ? 'Creating...' : 'Create Partner & Generate Key'}
            </button>
          </div>
        </div>

        <div className="ops-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="ops-label">Partner Directory</div>
              <h2 className="mt-2 text-xl font-semibold">Current Partners</h2>
            </div>
            <div className="text-xs text-ops-muted">
              Page
              {' '}
              {page}
              {' '}
              of
              {' '}
              {totalPages}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ops-muted">
                  <th className="px-2 py-2" scope="col">Partner</th>
                  <th className="px-2 py-2" scope="col">Contact</th>
                  <th className="px-2 py-2" scope="col">Client Domain</th>
                  <th className="px-2 py-2" scope="col">Completed Volume</th>
                  <th className="px-2 py-2" scope="col">Created</th>
                  <th className="px-2 py-2" scope="col">API Key</th>
                  <th className="px-2 py-2" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => {
                  const isEditing = editingPartnerId === partner.id
                  const partnerBusy = isPartnerBusy(partner.id)
                  const saveDomainKey = buildActionKey('save-domain', partner.id)
                  const clearDomainKey = buildActionKey('clear-domain', partner.id)
                  const rotateKey = buildActionKey('rotate', partner.id)
                  const revokeKey = buildActionKey('revoke', partner.id)
                  const editingAnotherPartner = editingPartnerId !== null && editingPartnerId !== partner.id

                  return (
                    <tr className="border-t border-ops-border" key={partner.id}>
                      <td className="px-2 py-3 align-top">
                        <div className="font-medium">{partner.name}</div>
                        <div className="text-xs text-ops-muted">{partner.id}</div>
                      </td>
                      <td className="px-2 py-3 align-top">
                        <div>{partner.email || '—'}</div>
                        <div className="text-xs text-ops-muted">
                          {partner.firstName || ''}
                          {partner.firstName && partner.lastName ? ' ' : ''}
                          {partner.lastName || ''}
                        </div>
                      </td>
                      <td className="px-2 py-3 align-top">
                        {isEditing
                          ? (
                              <div className="flex flex-col gap-2">
                                <input
                                  aria-label={`Client domain for ${partner.name}`}
                                  className="ops-input h-10"
                                  onChange={event => setEditingClientDomain(event.target.value)}
                                  placeholder="app.example.com"
                                  type="text"
                                  value={editingClientDomain}
                                />
                                <div className="text-xs text-ops-muted">
                                  Save a hostname or full URL. The backend stores the canonical host only.
                                </div>
                              </div>
                            )
                          : (
                              <div>
                                <div className="break-all font-medium">
                                  {partner.clientDomain || '—'}
                                </div>
                                <div className="text-xs text-ops-muted">
                                  {partner.clientDomain ? 'Origin-based auth enabled' : 'No browser origin configured'}
                                </div>
                              </div>
                            )}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <CompletedVolume volume={partner.completedVolume} />
                      </td>
                      <td className="px-2 py-3 align-top text-xs text-ops-muted">{formatDateTime(partner.createdAt)}</td>
                      <td className="px-2 py-3 align-top">
                        <OpsStatusBadge tone={partner.hasApiKey ? 'success' : 'danger'}>
                          {partner.hasApiKey ? 'Active' : 'Revoked'}
                        </OpsStatusBadge>
                      </td>
                      <td className="px-2 py-3 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          {isEditing
                            ? (
                                <>
                                  <button
                                    className="ops-btn-primary ops-btn-sm"
                                    disabled={!opsApiKey || partnerBusy}
                                    onClick={() => void handleSaveClientDomain(partner)}
                                    type="button"
                                  >
                                    {actionLoading === saveDomainKey ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    className="ops-btn-neutral ops-btn-sm"
                                    disabled={partnerBusy}
                                    onClick={stopEditingClientDomain}
                                    type="button"
                                  >
                                    Cancel
                                  </button>
                                </>
                              )
                            : (
                                <>
                                  <button
                                    className="ops-btn-neutral ops-btn-sm"
                                    disabled={!opsApiKey || partnerBusy || editingAnotherPartner}
                                    onClick={() => startEditingClientDomain(partner)}
                                    type="button"
                                  >
                                    {partner.clientDomain ? 'Edit Domain' : 'Set Domain'}
                                  </button>
                                  {partner.clientDomain && (
                                    <button
                                      className="ops-btn-neutral ops-btn-sm"
                                      disabled={!opsApiKey || partnerBusy || editingAnotherPartner}
                                      onClick={() => void handleClearClientDomain(partner)}
                                      type="button"
                                    >
                                      {actionLoading === clearDomainKey ? 'Clearing...' : 'Clear Domain'}
                                    </button>
                                  )}
                                </>
                              )}
                          <button
                            className="ops-btn-neutral ops-btn-sm"
                            disabled={!opsApiKey || partnerBusy || isEditing}
                            onClick={() => void handleRotate(partner)}
                            type="button"
                          >
                            {actionLoading === rotateKey ? 'Rotating...' : 'Rotate Key'}
                          </button>
                          <button
                            className="ops-btn-danger ops-btn-sm"
                            disabled={!opsApiKey || partnerBusy || isEditing || !partner.hasApiKey}
                            onClick={() => void handleRevoke(partner)}
                            type="button"
                          >
                            {actionLoading === revokeKey ? 'Revoking...' : 'Revoke'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!loading && opsApiKey && partners.length === 0 && (
            <div className="mt-6">
              <OpsEmptyState>No partners found.</OpsEmptyState>
            </div>
          )}

          {loading && opsApiKey && (
            <div className="mt-6">
              <OpsLoading label="Loading partners…" />
            </div>
          )}

          <div className="mt-5 flex items-center justify-end">
            <OpsPagination
              loading={loading}
              onChange={setPage}
              page={page}
              totalPages={totalPages}
            />
          </div>
        </div>
      </div>
    </OpsPageShell>
  )
}

export default PartnerApiKeys
