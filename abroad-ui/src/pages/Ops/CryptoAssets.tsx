import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { createOpsConfigurationRelease } from '../../services/admin/configurationReleaseAdminApi'
import { listCryptoAssets } from '../../services/admin/flowAdminApi'
import {
  CryptoAssetCoverage,
  CryptoAssetCoverageResponse,
} from '../../services/admin/flowTypes'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
  OpsUnsavedChangesGuard,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

type AssetDraft = {
  decimals: string
  effectiveAt: string
  enabled: boolean
  mintAddress: string
}

type AssetFilter = 'all' | 'configured' | 'enabled' | 'missing'
type DraftMap = Record<string, AssetDraft>
type SaveState = Record<string, boolean>

const statusTone: Record<CryptoAssetCoverage['status'], OpsTone> = {
  CONFIGURED: 'success',
  MISSING: 'warning',
}

const buildKey = (asset: { blockchain: string, cryptoCurrency: string }): string => (
  `${asset.cryptoCurrency}:${asset.blockchain}`
)

const formatStatus = (status: CryptoAssetCoverage['status']): string => (
  status === 'CONFIGURED' ? 'Configured' : 'Missing'
)

const buildDraft = (asset: CryptoAssetCoverage): AssetDraft => ({
  decimals: asset.decimals === null || asset.decimals === undefined ? '' : String(asset.decimals),
  effectiveAt: '',
  enabled: asset.enabled,
  mintAddress: asset.mintAddress ?? '',
})

const buildDrafts = (assets: CryptoAssetCoverage[]): DraftMap => Object.fromEntries(
  assets.map(asset => [buildKey(asset), buildDraft(asset)]),
)

const normalizeDecimals = (value: string): { error: null | string, value: null | number } => {
  const trimmed = value.trim()
  if (!trimmed) return { error: null, value: null }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: 'Decimals must be a non-negative integer', value: null }
  }
  return { error: null, value: parsed }
}

const mintPlaceholder = (blockchain: string): string => {
  switch (blockchain) {
    case 'CELO': return 'Token contract address'
    case 'SOLANA': return 'Mint address'
    case 'STELLAR': return 'Issuer account (G...)'
    default: return 'Mint / issuer'
  }
}

const readFilter = (params: URLSearchParams): AssetFilter => {
  const value = params.get('status')
  return value === 'configured' || value === 'enabled' || value === 'missing' ? value : 'all'
}

const CryptoAssets = () => {
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const appliedSearch = useMemo(() => new URLSearchParams(paramsKey).get('query') ?? '', [paramsKey])
  const appliedFilter = useMemo(() => readFilter(new URLSearchParams(paramsKey)), [paramsKey])
  const appliedAsset = useMemo(() => new URLSearchParams(paramsKey).get('asset') ?? '', [paramsKey])
  const [searchDraft, setSearchDraft] = useState(appliedSearch)
  const [filterDraft, setFilterDraft] = useState<AssetFilter>(appliedFilter)
  const [assetDraft, setAssetDraft] = useState(appliedAsset)
  const [assets, setAssets] = useState<CryptoAssetCoverage[]>([])
  const [summary, setSummary] = useState<CryptoAssetCoverageResponse['summary'] | null>(null)
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [saving, setSaving] = useState<SaveState>({})
  const [error, setError] = useState<null | string>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [createdDraft, setCreatedDraft] = useState<null | { id: string, title: string }>(null)
  const canManage = Boolean(session?.permissions.includes('configuration:manage'))

  useEffect(() => {
    setSearchDraft(appliedSearch)
    setFilterDraft(appliedFilter)
    setAssetDraft(appliedAsset)
  }, [
    appliedAsset,
    appliedFilter,
    appliedSearch,
  ])

  const loadData = useCallback(async () => {
    if (!opsApiKey) {
      setAssets([])
      setSummary(null)
      setDrafts({})
      setRowErrors({})
      setError(null)
      return
    }
    setError(null)
    try {
      const result = await listCryptoAssets()
      setAssets(result.assets)
      setSummary(result.summary)
      setDrafts(buildDrafts(result.assets))
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load crypto assets')
    }
  }, [opsApiKey])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredAssets = useMemo(() => {
    const term = appliedSearch.trim().toLowerCase()
    return assets.filter((asset) => {
      if (appliedAsset && buildKey(asset) !== appliedAsset) return false
      if (appliedFilter === 'configured' && asset.status !== 'CONFIGURED') return false
      if (appliedFilter === 'missing' && asset.status !== 'MISSING') return false
      if (appliedFilter === 'enabled' && !asset.enabled) return false
      if (!term) return true
      return `${asset.cryptoCurrency} ${asset.blockchain}`.toLowerCase().includes(term)
    })
  }, [
    appliedAsset,
    appliedFilter,
    appliedSearch,
    assets,
  ])

  const isDirty = useCallback((asset: CryptoAssetCoverage): boolean => {
    const draft = drafts[buildKey(asset)]
    if (!draft) return false
    const mint = asset.mintAddress ?? ''
    const decimals = asset.decimals === null || asset.decimals === undefined ? '' : String(asset.decimals)
    return draft.enabled !== asset.enabled
      || draft.mintAddress.trim() !== mint
      || draft.decimals.trim() !== decimals
  }, [drafts])

  const hasDirtyDrafts = useMemo(() => assets.some(isDirty), [assets, isDirty])

  const setDraftValue = (key: string, next: Partial<AssetDraft>): void => {
    setDrafts(current => ({
      ...current,
      [key]: { ...current[key], ...next },
    }))
  }

  const resetAsset = (asset: CryptoAssetCoverage): void => {
    const key = buildKey(asset)
    setDrafts(current => ({ ...current, [key]: buildDraft(asset) }))
    setRowErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const handleSave = async (asset: CryptoAssetCoverage): Promise<void> => {
    const key = buildKey(asset)
    const draft = drafts[key]
    if (!draft) return
    const trimmedMint = draft.mintAddress.trim()
    if (draft.enabled && !trimmedMint) {
      setRowErrors(current => ({ ...current, [key]: 'Mint / issuer is required to enable this asset.' }))
      return
    }
    const decimalsResult = normalizeDecimals(draft.decimals)
    if (decimalsResult.error !== null) {
      setRowErrors(current => ({ ...current, [key]: decimalsResult.error ?? 'Invalid decimals' }))
      return
    }

    setRowErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setSaving(current => ({ ...current, [key]: true }))
    try {
      const title = `Update ${asset.cryptoCurrency} on ${humanizeStatus(asset.blockchain)} coverage`
      const release = await requestMutation({
        action: 'configuration.release.create',
        execute: mutation => createOpsConfigurationRelease({
          effectiveAt: draft.effectiveAt ? new Date(draft.effectiveAt).toISOString() : undefined,
          payload: {
            kind: 'CRYPTO_ASSET',
            value: {
              blockchain: asset.blockchain,
              cryptoCurrency: asset.cryptoCurrency,
              decimals: decimalsResult.value,
              enabled: draft.enabled,
              mintAddress: trimmedMint || null,
            },
          },
          title,
        }, mutation),
        resourceLabel: `${asset.cryptoCurrency} on ${humanizeStatus(asset.blockchain)}`,
        title: 'Create crypto asset review draft',
      })
      setCreatedDraft({ id: release.id, title: release.title })
      resetAsset(asset)
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) {
        setRowErrors(current => ({
          ...current,
          [key]: saveError instanceof Error ? saveError.message : 'Failed to create review draft',
        }))
      }
    }
    finally {
      setSaving(current => ({ ...current, [key]: false }))
    }
  }

  const applyFilters = (): void => {
    const next = new URLSearchParams()
    if (searchDraft.trim()) next.set('query', searchDraft.trim())
    if (filterDraft !== 'all') next.set('status', filterDraft)
    if (assetDraft) next.set('asset', assetDraft)
    setSearchParams(next)
  }

  const showMissing = (): void => {
    setSearchParams(new URLSearchParams({ status: 'missing' }))
  }

  return (
    <OpsPageShell
      actions={<button className="ops-btn-ghost" disabled={!opsApiKey || hasDirtyDrafts} onClick={() => void loadData()} type="button">Refresh</button>}
      error={error}
      eyebrow="Configuration"
      keyRequiredMessage="Sign in to review crypto asset coverage."
      subtitle="Prepare reviewed changes for crypto and network eligibility. Production changes only after approval."
      title="Asset Coverage"
    >
      <OpsUnsavedChangesGuard active={hasDirtyDrafts} />
      {createdDraft && (
        <OpsBanner className="mt-5" variant="success">
          Review draft created:
          {' '}
          <Link className="font-semibold underline underline-offset-4" to={`/ops/configuration/history?release=${encodeURIComponent(createdDraft.id)}`}>{createdDraft.title}</Link>
          . Production is unchanged until approval.
        </OpsBanner>
      )}
      {hasDirtyDrafts && (
        <OpsBanner className="mt-5" variant="info">Unsaved asset edits are protected. Create a review draft or reset the edited row before changing views.</OpsBanner>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Total combinations</div>
          <div className="mt-2 text-2xl font-semibold text-ops-text">{summary?.total ?? '—'}</div>
        </div>
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Configured</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.configured ?? '—'}</div>
        </div>
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Available for routing</div>
          <div className="mt-2 text-2xl font-semibold text-abroad-dark">{summary?.enabled ?? '—'}</div>
        </div>
        <button className="ops-card min-h-24 px-5 py-4 text-left hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-brand" disabled={hasDirtyDrafts} onClick={showMissing} type="button">
          <div className="ops-label">Missing coverage</div>
          <div className="mt-2 text-2xl font-semibold text-amber-700">{summary?.missing ?? '—'}</div>
          <div className="mt-1 text-xs font-medium text-amber-800">Open missing combinations</div>
        </button>
      </div>

      <section aria-labelledby="asset-filters-title" className="ops-card mt-8 p-5">
        <h2 className="font-semibold text-ops-text" id="asset-filters-title">Find asset coverage</h2>
        <p className="mt-1 text-sm text-ops-muted">Filters are applied explicitly and preserved in the URL for handoff.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <OpsField label="Asset or network"><input className="ops-input" name="asset-search" onChange={event => setSearchDraft(event.target.value)} placeholder="USDC or Stellar" value={searchDraft} /></OpsField>
          <OpsField label="Coverage status">
            <select className="ops-input" name="asset-status" onChange={event => setFilterDraft(event.target.value as AssetFilter)} value={filterDraft}>
              <option value="all">All coverage</option>
              <option value="configured">Configured</option>
              <option value="enabled">Available for routing</option>
              <option value="missing">Missing</option>
            </select>
          </OpsField>
          <OpsField label="Selected combination">
            <select className="ops-input" name="selected-asset" onChange={event => setAssetDraft(event.target.value)} value={assetDraft}>
              <option value="">All combinations</option>
              {assets.map(asset => (
                <option key={buildKey(asset)} value={buildKey(asset)}>
                  {asset.cryptoCurrency}
                  {' '}
                  on
                  {' '}
                  {humanizeStatus(asset.blockchain)}
                </option>
              ))}
            </select>
          </OpsField>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="ops-btn-primary" disabled={hasDirtyDrafts} onClick={applyFilters} type="button">Apply filters</button>
          <button className="ops-btn-neutral" disabled={hasDirtyDrafts} onClick={() => setSearchParams(new URLSearchParams())} type="button">Clear</button>
        </div>
      </section>

      <section aria-label="Asset configuration records" className="mt-6 space-y-4">
        {filteredAssets.map((asset) => {
          const key = buildKey(asset)
          const draft = drafts[key]
          const rowError = rowErrors[key]
          const dirty = isDirty(asset)
          const savingRow = Boolean(saving[key])
          return (
            <article className="ops-card px-4 py-4 sm:px-5" key={key}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-ops-text">
                      {asset.cryptoCurrency}
                      {' '}
                      on
                      {' '}
                      {humanizeStatus(asset.blockchain)}
                    </h2>
                    <p className="mt-1 text-xs text-ops-muted">
                      Last changed
                      {formatDateTime(asset.updatedAt)}
                    </p>
                    <code className="mt-1 block text-[11px] text-ops-muted">{key}</code>
                  </div>
                  <OpsStatusBadge tone={statusTone[asset.status]}>{formatStatus(asset.status)}</OpsStatusBadge>
                </div>

                <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-[11rem_minmax(0,1fr)_9rem_minmax(12rem,0.7fr)] xl:items-end">
                  <div className="flex flex-col gap-2">
                    <span className="ops-label">Routing availability</span>
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-ops-border bg-white px-3 text-sm text-ops-text focus-within:ring-2 focus-within:ring-ops-brand/50">
                      <input checked={draft?.enabled ?? false} className="size-5 rounded border-ops-border accent-ops-brand" disabled={!canManage} name={`enabled-${key}`} onChange={event => setDraftValue(key, { enabled: event.target.checked })} type="checkbox" />
                      {draft?.enabled ? 'Available' : 'Unavailable'}
                    </label>
                  </div>
                  <OpsField error={rowError?.includes('Mint / issuer') ? rowError : undefined} hint="Network token contract, mint, or issuer. Raw provider value." label="Mint or issuer">
                    <input autoComplete="off" className="ops-input font-mono text-xs" disabled={!canManage} name={`mint-${key}`} onChange={event => setDraftValue(key, { mintAddress: event.target.value })} placeholder={mintPlaceholder(asset.blockchain)} value={draft?.mintAddress ?? ''} />
                  </OpsField>
                  <OpsField error={rowError?.includes('Decimals') ? rowError : undefined} hint="Blank uses network default." label="Decimals">
                    <input className="ops-input" disabled={!canManage} min={0} name={`decimals-${key}`} onChange={event => setDraftValue(key, { decimals: event.target.value })} placeholder="Auto" type="number" value={draft?.decimals ?? ''} />
                  </OpsField>
                  <OpsField hint="Blank applies immediately after approval." label="Effective time">
                    <input className="ops-input" disabled={!canManage} name={`effective-at-${key}`} onChange={event => setDraftValue(key, { effectiveAt: event.target.value })} type="datetime-local" value={draft?.effectiveAt ?? ''} />
                  </OpsField>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button className="ops-btn-neutral" disabled={!dirty || savingRow} onClick={() => resetAsset(asset)} type="button">Reset</button>
                  <button className="ops-btn-primary" disabled={!canManage || !dirty || savingRow} onClick={() => void handleSave(asset)} type="button">{savingRow ? 'Creating draft…' : 'Create review draft'}</button>
                </div>
              </div>
              {rowError && !rowError.includes('Mint / issuer') && !rowError.includes('Decimals') && <div className="mt-3 text-sm text-rose-700" role="alert">{rowError}</div>}
            </article>
          )
        })}
        {filteredAssets.length === 0 && <div className="ops-card px-5 py-6"><OpsEmptyState>No assets match this applied view.</OpsEmptyState></div>}
      </section>
    </OpsPageShell>
  )
}

export default CryptoAssets
