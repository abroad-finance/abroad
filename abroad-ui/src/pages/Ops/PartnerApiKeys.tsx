import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link } from 'react-router-dom'

import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  createPartner,
  getPartnerCredentialHistory,
  listPartners,
  revokePartnerApiKey,
  rotatePartnerApiKey,
  updatePartnerClientDomain,
  updatePartnerKycRequirement,
} from '../../services/admin/partnerAdminApi'
import {
  OpsCreatePartnerInput,
  OpsPartner,
  OpsPartnerCompletedVolume,
  OpsPartnerCredentialHistory,
  OpsPartnerListItem,
} from '../../services/admin/partnerTypes'
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

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

type CredentialHistoryPanelProps = {
  history: OpsPartnerCredentialHistory
}

type RevealedKey = {
  action: 'created' | 'rotated'
  apiKey: string
  partnerId: string
  partnerName: string
}

const credentialStatusTone = {
  ACTIVE: 'success',
  EXPIRED: 'warning',
  REVOKED: 'danger',
} as const

const CredentialHistoryPanel = ({ history }: CredentialHistoryPanelProps) => (
  <section
    aria-label={`Credential history for ${history.partner.name}`}
    className="mt-4 rounded-2xl border border-ops-border bg-stone-50/80 p-4"
  >
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="ops-label">Credential history</div>
        <h3 className="mt-1 text-base font-semibold text-ops-text">Legacy and managed API keys</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <OpsStatusBadge tone={history.legacyCredential.active ? 'success' : 'danger'}>
          Legacy key
          {' '}
          {history.legacyCredential.active ? 'active' : 'revoked'}
        </OpsStatusBadge>
        {history.legacyCredential.overlapExpiresAt && (
          <OpsStatusBadge tone="warning">
            Previous key valid until
            {' '}
            {formatDateTime(history.legacyCredential.overlapExpiresAt)}
          </OpsStatusBadge>
        )}
      </div>
    </div>

    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {history.managedCredentials.map(credential => (
        <article className="rounded-xl border border-ops-border bg-white p-3" key={credential.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-words text-sm font-semibold text-ops-text">{credential.name}</div>
              <code className="mt-1 block break-all text-[11px] text-ops-muted">
                {credential.displayPrefix}
                …
              </code>
            </div>
            <OpsStatusBadge
              label={humanizeStatus(credential.status)}
              tone={credentialStatusTone[credential.status]}
            />
          </div>
          <dl className="mt-3 grid gap-2 text-xs text-ops-muted sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-ops-label">Created</dt>
              <dd>{formatDateTime(credential.createdAt)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ops-label">Last used</dt>
              <dd>{formatDateTime(credential.lastUsedAt)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ops-label">Expires</dt>
              <dd>{formatDateTime(credential.expiresAt)}</dd>
            </div>
            <div>
              <dt className="font-semibold text-ops-label">Scopes</dt>
              <dd>{credential.scopes.map(humanizeStatus).join(', ') || 'None'}</dd>
            </div>
          </dl>
          {(credential.rotatedFromId || credential.rotatedToId) && (
            <div className="mt-3 break-all font-mono text-[10px] text-ops-muted">
              {credential.rotatedFromId && `Rotated from ${credential.rotatedFromId}`}
              {credential.rotatedFromId && credential.rotatedToId && ' · '}
              {credential.rotatedToId && `Rotated to ${credential.rotatedToId}`}
            </div>
          )}
        </article>
      ))}
    </div>
    {history.managedCredentials.length === 0 && (
      <div className="mt-4 rounded-xl border border-dashed border-ops-border bg-white px-4 py-3 text-sm text-ops-muted">
        No managed API keys have been created for this partner.
      </div>
    )}

    <div className="mt-5">
      <h3 className="text-sm font-semibold text-ops-text">Lifecycle events</h3>
      <ol className="mt-2 space-y-2">
        {history.events.map(event => (
          <li className="rounded-xl border border-ops-border bg-white px-3 py-2.5" key={`${event.source}:${event.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-ops-text">{humanizeStatus(event.action)}</div>
                <div className="mt-0.5 text-xs text-ops-muted">
                  {event.actorLabel}
                  {' · '}
                  {event.source === 'OPS' ? 'Abroad Ops' : 'Partner portal'}
                </div>
              </div>
              <time className="text-xs text-ops-muted" dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
            </div>
            {(event.reason || event.reference) && (
              <div className="mt-2 text-xs text-ops-muted">
                {event.reason && <span>{event.reason}</span>}
                {event.reason && event.reference && ' · '}
                {event.reference && (
                  <span>
                    Reference:
                    {event.reference}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {history.events.length === 0 && (
        <div className="mt-2 text-sm text-ops-muted">No credential lifecycle events recorded yet.</div>
      )}
    </div>
  </section>
)

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

type CompletedVolumeProps = {
  maximumAmount: number
  rank: number
  volume: OpsPartnerCompletedVolume
}

const readSourceAmount = (
  volume: OpsPartnerCompletedVolume,
  currency: 'USDC' | 'USDT',
): number => volume.source.find(item => item.currency === currency)?.amount ?? 0

const CompletedVolume = ({ maximumAmount, rank, volume }: CompletedVolumeProps) => {
  const usdcAmount = readSourceAmount(volume, 'USDC')
  const usdtAmount = readSourceAmount(volume, 'USDT')
  const sourceAmount = usdcAmount + usdtAmount
  const totalWidth = maximumAmount > 0
    ? Math.min(100, Math.max(0, (volume.stablecoinAmount / maximumAmount) * 100))
    : 0
  const usdcWidth = sourceAmount > 0 ? (usdcAmount / sourceAmount) * totalWidth : 0
  const usdtWidth = sourceAmount > 0 ? totalWidth - usdcWidth : 0
  const sourceBreakdown = volume.source
    .map(item => `${formatAmount(item.amount)} ${item.currency}`)
    .join(', ')
  const meterLabel = `Rank ${rank}: ${formatAmount(volume.stablecoinAmount)} USD stablecoins across ${volume.completedTransactions.toLocaleString('en-US')} completed transactions${sourceBreakdown ? `; ${sourceBreakdown}` : ''}`
  const rankClassName = rank <= 3
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-ops-border bg-stone-50 text-ops-muted'

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div
          aria-label={`Volume rank ${rank}`}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold tabular-nums ${rankClassName}`}
        >
          #
          {rank}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-lg font-semibold tabular-nums text-ops-text">
              {formatAmount(volume.stablecoinAmount)}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ops-label">
              USD stablecoins
            </span>
          </div>
          <div className="text-xs text-ops-muted">
            {volume.completedTransactions.toLocaleString('en-US')}
            {' '}
            completed
          </div>
        </div>
      </div>

      <svg
        aria-label={meterLabel}
        className="block h-2.5 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 8"
      >
        <rect className="fill-stone-200" height="8" rx="4" width="100" x="0" y="0" />
        {usdcWidth > 0 && (
          <rect
            className="fill-ops-brand"
            data-currency="USDC"
            height="8"
            rx={usdtWidth > 0 ? 0 : 4}
            width={usdcWidth}
            x="0"
            y="0"
          />
        )}
        {usdtWidth > 0 && (
          <rect
            className="fill-amber-400"
            data-currency="USDT"
            height="8"
            rx="4"
            width={usdtWidth}
            x={usdcWidth}
            y="0"
          />
        )}
      </svg>

      <div className="flex flex-wrap gap-1.5">
        {volume.source.map(item => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-ops-border bg-white px-2 py-1 text-[11px] font-medium tabular-nums text-ops-text"
            key={item.currency}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${item.currency === 'USDC' ? 'bg-ops-brand' : 'bg-amber-400'}`}
            />
            {formatAmount(item.amount)}
            {' '}
            {item.currency}
          </span>
        ))}
        {volume.source.length === 0 && (
          <span className="rounded-full border border-dashed border-ops-border px-2 py-1 text-[11px] text-ops-muted">
            No completed volume
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ops-label">Paid</span>
        {volume.payout.map(item => (
          <span
            className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-medium tabular-nums text-ops-muted"
            key={item.currency}
          >
            {formatMoney(item.amount, item.currency)}
          </span>
        ))}
        {volume.payout.length === 0 && <span className="text-[11px] text-ops-muted">—</span>}
      </div>
    </div>
  )
}

const PartnerApiKeys = () => {
  const { requestMutation } = useOpsMutation()
  const authenticationMarker = useOpsApiKey()
  const session = useOpsSession()
  const opsApiKey = session?.permissions.includes('credentials:manage') ? authenticationMarker : null
  const [partners, setPartners] = useState<OpsPartnerListItem[]>([])
  const [maximumStablecoinAmount, setMaximumStablecoinAmount] = useState(0)
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
  const [credentialHistory, setCredentialHistory] = useState<null | OpsPartnerCredentialHistory>(null)
  const [historyPartnerId, setHistoryPartnerId] = useState<null | string>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<null | string>(null)
  const [copied, setCopied] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total])

  const loadPartners = useCallback(async (targetPage: number = page) => {
    if (!opsApiKey) {
      setPartners([])
      setMaximumStablecoinAmount(0)
      setTotal(0)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await listPartners({ page: targetPage, pageSize })
      setPartners(response.items)
      setMaximumStablecoinAmount(response.maximumStablecoinAmount)
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

  const loadCredentialHistory = useCallback(async (partnerId: string) => {
    setHistoryPartnerId(partnerId)
    setCredentialHistory(null)
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      setCredentialHistory(await getPartnerCredentialHistory(partnerId))
    }
    catch (historyLoadError) {
      setHistoryError(historyLoadError instanceof Error
        ? historyLoadError.message
        : 'Failed to load credential history')
    }
    finally {
      setHistoryLoading(false)
    }
  }, [])

  const toggleCredentialHistory = useCallback((partnerId: string) => {
    if (historyPartnerId === partnerId) {
      setHistoryPartnerId(null)
      setCredentialHistory(null)
      setHistoryError(null)
      return
    }
    void loadCredentialHistory(partnerId)
  }, [historyPartnerId, loadCredentialHistory])

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
      const payload = createPayload()
      const response = await requestMutation({
        action: 'partner.create',
        execute: mutation => createPartner(payload, mutation),
        resourceLabel: payload.company,
        title: 'Create production partner',
      })
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
      if (isOpsMutationCancelledError(createError)) return
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
      const response = await requestMutation({
        action: 'credentials.api_key.rotate',
        execute: mutation => rotatePartnerApiKey(partner.id, mutation),
        resourceLabel: partner.name,
        title: 'Rotate partner API key',
      })
      updatePartnerRecord(response.partner)
      setRevealedKey({
        action: 'rotated',
        apiKey: response.apiKey,
        partnerId: response.partner.id,
        partnerName: response.partner.name,
      })
      if (historyPartnerId === partner.id) await loadCredentialHistory(partner.id)
    }
    catch (rotateError) {
      if (isOpsMutationCancelledError(rotateError)) return
      setError(rotateError instanceof Error ? rotateError.message : 'Failed to rotate API key')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleRevoke = async (partner: OpsPartner) => {
    const key = buildActionKey('revoke', partner.id)
    setActionLoading(key)
    setError(null)

    try {
      await requestMutation({
        action: 'credentials.api_key.revoke',
        execute: mutation => revokePartnerApiKey(partner.id, mutation),
        resourceLabel: partner.name,
        title: 'Revoke partner API key',
      })
      setPartners(current => current.map(item => (
        item.id === partner.id
          ? { ...item, hasApiKey: false }
          : item
      )))
      if (revealedKey?.partnerId === partner.id) {
        setRevealedKey(null)
      }
      if (historyPartnerId === partner.id) await loadCredentialHistory(partner.id)
    }
    catch (revokeError) {
      if (isOpsMutationCancelledError(revokeError)) return
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
      const clientDomain = editingClientDomain.trim() || null
      const updatedPartner = await requestMutation({
        action: 'credentials.client_domain.update',
        execute: mutation => updatePartnerClientDomain(partner.id, { clientDomain }, mutation),
        resourceLabel: `${partner.name} · ${clientDomain ?? 'No trusted domain'}`,
        title: 'Update trusted browser domain',
      })
      updatePartnerRecord(updatedPartner)
      stopEditingClientDomain()
      if (historyPartnerId === partner.id) await loadCredentialHistory(partner.id)
    }
    catch (saveError) {
      if (isOpsMutationCancelledError(saveError)) return
      setError(saveError instanceof Error ? saveError.message : 'Failed to save client domain')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleToggleKyc = async (partner: OpsPartner) => {
    const key = buildActionKey('toggle-kyc', partner.id)
    const needsKyc = !partner.needsKyc
    setActionLoading(key)
    setError(null)

    try {
      const updatedPartner = await requestMutation({
        action: 'partner.kyc_requirement.update',
        execute: mutation => updatePartnerKycRequirement(partner.id, { needsKyc }, mutation),
        resourceLabel: `${partner.name} · KYC ${needsKyc ? 'required' : 'not required'}`,
        title: needsKyc ? 'Require KYC for this partner' : 'Disable KYC for this partner',
      })
      updatePartnerRecord(updatedPartner)
    }
    catch (toggleError) {
      if (isOpsMutationCancelledError(toggleError)) return
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update the KYC requirement')
    }
    finally {
      setActionLoading(null)
    }
  }

  const handleClearClientDomain = async (partner: OpsPartner) => {
    const key = buildActionKey('clear-domain', partner.id)
    setActionLoading(key)
    setError(null)

    try {
      const updatedPartner = await requestMutation({
        action: 'credentials.client_domain.update',
        execute: mutation => updatePartnerClientDomain(partner.id, { clientDomain: null }, mutation),
        resourceLabel: partner.name,
        title: 'Clear trusted browser domain',
      })
      updatePartnerRecord(updatedPartner)
      if (editingPartnerId === partner.id) {
        stopEditingClientDomain()
      }
      if (historyPartnerId === partner.id) await loadCredentialHistory(partner.id)
    }
    catch (clearError) {
      if (isOpsMutationCancelledError(clearError)) return
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
        <div className="flex flex-wrap gap-2">
          <Link className="ops-btn-neutral" to="/ops/partners">Partner activity</Link>
          <button
            className="ops-btn-ghost"
            disabled={!opsApiKey || loading}
            onClick={() => void loadPartners()}
            type="button"
          >
            Refresh
          </button>
        </div>
      )}
      error={error}
      eyebrow="Partners & Compliance / Credentials"
      keyRequiredMessage="Named administrator access is required to manage partner credentials."
      subtitle="Administrator-only partner onboarding, trusted domains, credential status, and protected key lifecycle operations."
      title="Partner credentials"
      width="full"
    >
      {session && !session.permissions.includes('credentials:manage') && (
        <OpsBanner className="mt-6" variant="warning">Your current role can review partner activity but cannot access onboarding, domains, or credentials.</OpsBanner>
      )}
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
              {revealedKey.action === 'rotated' && (
                <div className="mt-2 text-xs font-medium text-amber-900">
                  The previous key remains valid for up to 24 hours so the partner can move traffic safely.
                </div>
              )}
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

      <div className="mt-8 grid min-w-0 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="ops-card h-fit min-w-0 p-5">
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

        <div className="ops-card min-w-0 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="ops-label">Partner Directory</div>
              <h2 className="mt-2 text-xl font-semibold">Current Partners</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ops-muted">
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
                Highest Volume First
              </span>
              <span>
                Page
                {' '}
                {page}
                {' '}
                of
                {' '}
                {totalPages}
              </span>
            </div>
          </div>

          {partners.length > 0 && (
            <ol aria-label="Partners ranked by completed volume" className="mt-4 space-y-3">
              {partners.map((partner, index) => {
                const isEditing = editingPartnerId === partner.id
                const partnerBusy = isPartnerBusy(partner.id)
                const saveDomainKey = buildActionKey('save-domain', partner.id)
                const clearDomainKey = buildActionKey('clear-domain', partner.id)
                const rotateKey = buildActionKey('rotate', partner.id)
                const revokeKey = buildActionKey('revoke', partner.id)
                const toggleKycKey = buildActionKey('toggle-kyc', partner.id)
                const editingAnotherPartner = editingPartnerId !== null && editingPartnerId !== partner.id

                return (
                  <li
                    className="min-w-0 rounded-2xl border border-ops-border bg-white/70 p-4 shadow-[0_16px_36px_-34px_rgba(15,23,42,0.55)]"
                    key={partner.id}
                  >
                    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(260px,1.1fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="ops-label">Partner</div>
                        <div className="mt-1 break-words text-base font-semibold text-ops-text">
                          {partner.name}
                        </div>
                        <div className="mt-1 break-all font-mono text-[11px] text-ops-muted">
                          {partner.id}
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-ops-muted">
                          <div className="min-w-0">
                            <span className="font-semibold text-ops-label">Email</span>
                            {' · '}
                            <span className="break-all">{partner.email || '—'}</span>
                          </div>
                          {(partner.firstName || partner.lastName) && (
                            <div className="break-words">
                              {[partner.firstName, partner.lastName].filter(Boolean).join(' ')}
                            </div>
                          )}
                          <div>
                            Created
                            {' '}
                            {formatDateTime(partner.createdAt)}
                          </div>
                        </div>
                      </div>

                      <CompletedVolume
                        maximumAmount={maximumStablecoinAmount}
                        rank={((page - 1) * pageSize) + index + 1}
                        volume={partner.completedVolume}
                      />

                      <div className="flex items-start gap-4 lg:justify-end">
                        <div>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ops-label">
                            API Key
                          </div>
                          <OpsStatusBadge tone={partner.hasApiKey ? 'success' : 'danger'}>
                            {partner.hasApiKey ? 'Active' : 'Revoked'}
                          </OpsStatusBadge>
                        </div>
                        <div>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ops-label">
                            KYC
                          </div>
                          <OpsStatusBadge tone={partner.needsKyc ? 'success' : 'warning'}>
                            {partner.needsKyc ? 'Required' : 'Disabled'}
                          </OpsStatusBadge>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid min-w-0 gap-4 border-t border-ops-border pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                      <div className="min-w-0">
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ops-label">
                          Trusted Browser Domain
                        </div>
                        {isEditing
                          ? (
                              <div className="flex min-w-0 flex-col gap-2">
                                <input
                                  aria-label={`Client domain for ${partner.name}`}
                                  className="ops-input h-10 min-w-0 w-full"
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
                              <div className="min-w-0">
                                <div className="break-all font-medium">
                                  {partner.clientDomain || '—'}
                                </div>
                                <div className="text-xs text-ops-muted">
                                  {partner.clientDomain ? 'Origin-based auth enabled' : 'No browser origin configured'}
                                </div>
                              </div>
                            )}
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:max-w-[360px] lg:justify-end">
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
                          className={partner.needsKyc ? 'ops-btn-danger ops-btn-sm' : 'ops-btn-neutral ops-btn-sm'}
                          disabled={!opsApiKey || partnerBusy || isEditing}
                          onClick={() => void handleToggleKyc(partner)}
                          type="button"
                        >
                          {actionLoading === toggleKycKey
                            ? 'Updating...'
                            : partner.needsKyc ? 'Disable KYC' : 'Require KYC'}
                        </button>
                        <button
                          className="ops-btn-neutral ops-btn-sm"
                          disabled={!opsApiKey || partnerBusy || isEditing}
                          onClick={() => void handleRotate(partner)}
                          type="button"
                        >
                          {actionLoading === rotateKey ? 'Rotating...' : 'Rotate Key'}
                        </button>
                        <button
                          aria-expanded={historyPartnerId === partner.id}
                          className="ops-btn-neutral ops-btn-sm"
                          disabled={!opsApiKey || partnerBusy}
                          onClick={() => toggleCredentialHistory(partner.id)}
                          type="button"
                        >
                          {historyPartnerId === partner.id ? 'Hide History' : 'View History'}
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
                    </div>
                    {historyPartnerId === partner.id && (
                      <div aria-live="polite">
                        {historyLoading && <div className="mt-4"><OpsLoading label="Loading credential history…" /></div>}
                        {historyError && <OpsBanner className="mt-4" variant="error">{historyError}</OpsBanner>}
                        {credentialHistory && <CredentialHistoryPanel history={credentialHistory} />}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}

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
