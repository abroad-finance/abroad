import {
  useCallback, useEffect, useMemo, useState,
} from 'react'

import { listCryptoAssets, updateCryptoAsset } from '../../services/admin/flowAdminApi'
import {
  CryptoAssetCoverage,
  CryptoAssetCoverageResponse,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  OpsEmptyState,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'

type AssetDraft = {
  decimals: string
  enabled: boolean
  mintAddress: string
}

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

const buildDrafts = (assets: CryptoAssetCoverage[]): DraftMap => {
  const drafts: DraftMap = {}
  assets.forEach((asset) => {
    drafts[buildKey(asset)] = {
      decimals: asset.decimals === null || asset.decimals === undefined ? '' : String(asset.decimals),
      enabled: asset.enabled,
      mintAddress: asset.mintAddress ?? '',
    }
  })
  return drafts
}

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
    case 'CELO':
      return 'Token contract address'
    case 'SOLANA':
      return 'Mint address'
    case 'STELLAR':
      return 'Issuer account (G...)'
    default:
      return 'Mint / issuer'
  }
}

const CryptoAssets = () => {
  const opsApiKey = useOpsApiKey()
  const [assets, setAssets] = useState<CryptoAssetCoverage[]>([])
  const [summary, setSummary] = useState<CryptoAssetCoverageResponse['summary'] | null>(null)
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [saving, setSaving] = useState<SaveState>({})
  const [error, setError] = useState<null | string>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'configured' | 'enabled' | 'missing'>('all')

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
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load crypto assets')
    }
  }, [opsApiKey])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase()
    return assets.filter((asset) => {
      if (filter === 'configured' && asset.status !== 'CONFIGURED') return false
      if (filter === 'missing' && asset.status !== 'MISSING') return false
      if (filter === 'enabled' && !asset.enabled) return false
      if (!term) return true
      const label = `${asset.cryptoCurrency} ${asset.blockchain}`.toLowerCase()
      return label.includes(term)
    })
  }, [
    assets,
    filter,
    search,
  ])

  const isDirty = (asset: CryptoAssetCoverage): boolean => {
    const draft = drafts[buildKey(asset)]
    if (!draft) return false
    const mint = asset.mintAddress ?? ''
    const decimals = asset.decimals === null || asset.decimals === undefined ? '' : String(asset.decimals)
    return (
      draft.enabled !== asset.enabled
      || draft.mintAddress.trim() !== mint
      || draft.decimals.trim() !== decimals
    )
  }

  const handleSave = async (asset: CryptoAssetCoverage) => {
    const key = buildKey(asset)
    const draft = drafts[key]
    if (!draft) return

    const trimmedMint = draft.mintAddress.trim()
    if (draft.enabled && !trimmedMint) {
      setRowErrors(prev => ({ ...prev, [key]: 'Mint / issuer is required to enable this asset.' }))
      return
    }

    const decimalsResult = normalizeDecimals(draft.decimals)
    const decimalsError = decimalsResult.error
    if (decimalsError !== null) {
      setRowErrors(prev => ({ ...prev, [key]: decimalsError }))
      return
    }

    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSaving(prev => ({ ...prev, [key]: true }))

    try {
      await updateCryptoAsset({
        blockchain: asset.blockchain,
        cryptoCurrency: asset.cryptoCurrency,
        decimals: decimalsResult.value,
        enabled: draft.enabled,
        mintAddress: trimmedMint || null,
      })
      await loadData()
    }
    catch (err) {
      setRowErrors(prev => ({ ...prev, [key]: err instanceof Error ? err.message : 'Failed to update asset' }))
    }
    finally {
      setSaving(prev => ({ ...prev, [key]: false }))
    }
  }

  const setDraftValue = (key: string, next: Partial<AssetDraft>) => {
    setDrafts(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...next,
      },
    }))
  }

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey}
          onClick={() => void loadData()}
          type="button"
        >
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Operations"
      keyRequiredMessage="Ops API key required to manage crypto assets."
      subtitle="Control which crypto + chain combinations are enabled and provide the mint or issuer address for each."
      title="Crypto Asset Coverage"
    >
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Total</div>
          <div className="mt-2 text-2xl font-semibold text-ops-text">{summary?.total ?? '—'}</div>
        </div>
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Configured</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.configured ?? '—'}</div>
        </div>
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Enabled</div>
          <div className="mt-2 text-2xl font-semibold text-abroad-dark">{summary?.enabled ?? '—'}</div>
        </div>
        <div className="ops-card px-5 py-4">
          <div className="ops-label">Missing</div>
          <div className="mt-2 text-2xl font-semibold text-amber-700">{summary?.missing ?? '—'}</div>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
          <div className="flex-1">
            <input
              aria-label="Search by asset or chain"
              className="w-full ops-input"
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by asset or chain"
              value={search}
            />
          </div>
          <select
            aria-label="Filter assets"
            className="ops-input"
            onChange={event => setFilter(event.target.value as typeof filter)}
            value={filter}
          >
            <option value="all">All</option>
            <option value="configured">Configured</option>
            <option value="enabled">Enabled</option>
            <option value="missing">Missing</option>
          </select>
        </div>
      </div>

      <div className="ops-card mt-6 overflow-x-auto">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_1.6fr_0.6fr_1fr_auto] gap-3 border-b border-ops-border px-5 py-3 ops-label">
          <div>Asset</div>
          <div>Status</div>
          <div>Enabled</div>
          <div>Mint / Issuer</div>
          <div>Decimals</div>
          <div>Updated</div>
          <div />
        </div>
        <div className="divide-y divide-ops-border">
          {filteredAssets.map((asset) => {
            const key = buildKey(asset)
            const draft = drafts[key]
            const rowError = rowErrors[key]
            const dirty = isDirty(asset)
            const savingRow = Boolean(saving[key])
            return (
              <div className="px-5 py-4" key={key}>
                <div className="grid grid-cols-[1.2fr_1fr_1fr_1.6fr_0.6fr_1fr_auto] gap-3 items-center">
                  <div>
                    <div className="text-sm font-semibold text-ops-text">{asset.cryptoCurrency}</div>
                    <div className="text-xs text-ops-muted">{asset.blockchain}</div>
                  </div>
                  <div>
                    <OpsStatusBadge tone={statusTone[asset.status]}>
                      {formatStatus(asset.status)}
                    </OpsStatusBadge>
                  </div>
                  <div>
                    <label className="inline-flex items-center gap-2 text-sm text-ops-text">
                      <input
                        checked={draft?.enabled ?? false}
                        className="h-4 w-4 rounded border-ops-border accent-ops-brand"
                        onChange={event => setDraftValue(key, { enabled: event.target.checked })}
                        type="checkbox"
                      />
                      {draft?.enabled ? 'Enabled' : 'Disabled'}
                    </label>
                  </div>
                  <div>
                    <input
                      aria-label={`Mint / issuer for ${asset.cryptoCurrency} on ${asset.blockchain}`}
                      className="w-full ops-input"
                      onChange={event => setDraftValue(key, { mintAddress: event.target.value })}
                      placeholder={mintPlaceholder(asset.blockchain)}
                      value={draft?.mintAddress ?? ''}
                    />
                  </div>
                  <div>
                    <input
                      aria-label={`Decimals for ${asset.cryptoCurrency} on ${asset.blockchain}`}
                      className="w-full ops-input"
                      min={0}
                      onChange={event => setDraftValue(key, { decimals: event.target.value })}
                      placeholder="Auto"
                      type="number"
                      value={draft?.decimals ?? ''}
                    />
                  </div>
                  <div className="text-sm text-ops-muted">{formatDateTime(asset.updatedAt)}</div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      className="ops-btn-primary disabled:opacity-50"
                      disabled={!dirty || savingRow}
                      onClick={() => void handleSave(asset)}
                      type="button"
                    >
                      {savingRow ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
                {rowError && (
                  <div className="mt-2 text-sm text-rose-700">{rowError}</div>
                )}
              </div>
            )
          })}
          {filteredAssets.length === 0 && (
            <div className="px-5 py-6">
              <OpsEmptyState>No assets match this filter.</OpsEmptyState>
            </div>
          )}
        </div>
      </div>
    </OpsPageShell>
  )
}

export default CryptoAssets
