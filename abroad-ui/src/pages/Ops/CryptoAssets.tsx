import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link } from 'react-router-dom'

import { listCryptoAssets, updateCryptoAsset } from '../../services/admin/flowAdminApi'
import {
  CryptoAssetCoverage,
  CryptoAssetCoverageResponse,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import OpsApiKeyPanel from './OpsApiKeyPanel'

type AssetDraft = {
  decimals: string
  enabled: boolean
  mintAddress: string
}

type DraftMap = Record<string, AssetDraft>

type SaveState = Record<string, boolean>

const buildKey = (asset: { blockchain: string, cryptoCurrency: string }): string => (
  `${asset.cryptoCurrency}:${asset.blockchain}`
)

const formatDate = (value: null | string | undefined): string => {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

const formatStatus = (status: CryptoAssetCoverage['status']): string => (
  status === 'CONFIGURED' ? 'Configured' : 'Missing'
)

const statusClasses: Record<CryptoAssetCoverage['status'], string> = {
  CONFIGURED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  MISSING: 'bg-amber-100 text-amber-800 border-amber-200',
}

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
    <div className="min-h-screen bg-[#F7F3EC] text-[#1A1A1A]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-[#356E6A]">Operations</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Crypto Asset Coverage</h1>
              <p className="text-sm text-[#4B5563] max-w-xl mt-2">
                Control which crypto + chain combinations are enabled and provide the mint or issuer address for each.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                className="px-4 py-2 rounded-xl border border-[#356E6A] text-[#356E6A] bg-white/70 hover:bg-white transition text-sm font-medium"
                to="/ops/flows"
              >
                Flow Ops
              </Link>
              <Link
                className="px-4 py-2 rounded-xl border border-[#356E6A] text-[#356E6A] bg-white/70 hover:bg-white transition text-sm font-medium"
                to="/ops/flows/definitions"
              >
                Flow Definitions
              </Link>
              <Link
                className="px-4 py-2 rounded-xl border border-[#356E6A] text-[#356E6A] bg-white/70 hover:bg-white transition text-sm font-medium"
                to="/ops/partners"
              >
                Partners
              </Link>
              <button
                className="px-4 py-2 rounded-xl border border-[#1B4D48] text-[#1B4D48] bg-white/70 hover:bg-white transition"
                disabled={!opsApiKey}
                onClick={() => void loadData()}
                type="button"
              >
                Refresh
              </button>
            </div>
          </div>

          <OpsApiKeyPanel />

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#5B6B6A]">Total</div>
              <div className="mt-2 text-2xl font-semibold text-[#1F2937]">{summary?.total ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#5B6B6A]">Configured</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">{summary?.configured ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#5B6B6A]">Enabled</div>
              <div className="mt-2 text-2xl font-semibold text-[#356E6A]">{summary?.enabled ?? '—'}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="text-xs uppercase tracking-[0.3em] text-[#5B6B6A]">Missing</div>
              <div className="mt-2 text-2xl font-semibold text-amber-700">{summary?.missing ?? '—'}</div>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
              <div className="flex-1">
                <input
                  className="w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search by asset or chain"
                  value={search}
                />
              </div>
              <select
                className="rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
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

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!opsApiKey && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to manage crypto assets.
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-white/70 bg-white/80 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_1.6fr_0.6fr_1fr_auto] gap-3 border-b border-white/70 px-5 py-3 text-xs uppercase tracking-[0.3em] text-[#5B6B6A]">
              <div>Asset</div>
              <div>Status</div>
              <div>Enabled</div>
              <div>Mint / Issuer</div>
              <div>Decimals</div>
              <div>Updated</div>
              <div />
            </div>
            <div className="divide-y divide-white/70">
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
                        <div className="text-sm font-semibold text-[#1F2937]">{asset.cryptoCurrency}</div>
                        <div className="text-xs text-[#6B7280]">{asset.blockchain}</div>
                      </div>
                      <div>
                        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[asset.status]}`}>
                          {formatStatus(asset.status)}
                        </span>
                      </div>
                      <div>
                        <label className="inline-flex items-center gap-2 text-sm text-[#1F2937]">
                          <input
                            checked={draft?.enabled ?? false}
                            className="h-4 w-4 rounded border-[#DADADA] text-[#356E6A] focus:ring-[#356E6A]"
                            onChange={event => setDraftValue(key, { enabled: event.target.checked })}
                            type="checkbox"
                          />
                          {draft?.enabled ? 'Enabled' : 'Disabled'}
                        </label>
                      </div>
                      <div>
                        <input
                          className="w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                          onChange={event => setDraftValue(key, { mintAddress: event.target.value })}
                          placeholder={mintPlaceholder(asset.blockchain)}
                          value={draft?.mintAddress ?? ''}
                        />
                      </div>
                      <div>
                        <input
                          className="w-full rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                          min={0}
                          onChange={event => setDraftValue(key, { decimals: event.target.value })}
                          placeholder="Auto"
                          type="number"
                          value={draft?.decimals ?? ''}
                        />
                      </div>
                      <div className="text-sm text-[#6B7280]">{formatDate(asset.updatedAt)}</div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="rounded-xl border border-[#356E6A] bg-[#356E6A] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B5B57] transition disabled:opacity-50"
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
                <div className="px-5 py-6 text-sm text-[#6B7280]">No assets match this filter.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CryptoAssets
