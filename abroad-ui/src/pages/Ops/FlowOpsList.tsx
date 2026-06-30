import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { bulkRetryFlowInstances, listFlowInstances } from '../../services/admin/flowAdminApi'
import {
  FlowBulkRetryResponse,
  FlowInstanceListResponse,
  FlowInstanceStatus,
  flowInstanceStatuses,
  FlowStepSummary,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const statusClasses: Record<FlowInstanceStatus, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  IN_PROGRESS: 'bg-sky-100 text-sky-800 border-sky-200',
  NOT_STARTED: 'bg-slate-100 text-slate-700 border-slate-200',
  WAITING: 'bg-amber-100 text-amber-800 border-amber-200',
}

const formatDate = (value: string) => new Date(value).toLocaleString()

const buildStepSummary = (summary: FlowStepSummary): string => {
  const parts = [
    summary.ready ? `ready ${summary.ready}` : null,
    summary.running ? `running ${summary.running}` : null,
    summary.waiting ? `waiting ${summary.waiting}` : null,
    summary.failed ? `failed ${summary.failed}` : null,
    summary.succeeded ? `done ${summary.succeeded}` : null,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' • ') : 'no steps'
}

const FlowOpsList = () => {
  const navigate = useNavigate()
  const [data, setData] = useState<FlowInstanceListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [status, setStatus] = useState<'' | FlowInstanceStatus>('')
  const [transactionId, setTransactionId] = useState('')
  const [onChainId, setOnChainId] = useState('')
  const [stuckMinutes, setStuckMinutes] = useState<string>('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<FlowBulkRetryResponse | null>(null)
  const pageSize = 20
  const opsApiKey = useOpsApiKey()

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setBulkResult(null)
  }, [])

  const query = useMemo(() => {
    const parsedStuck = Number(stuckMinutes)
    const normalizedStuck = Number.isFinite(parsedStuck) && parsedStuck > 0 ? parsedStuck : undefined

    return {
      onChainId: onChainId.trim() || undefined,
      page,
      pageSize,
      status: status || undefined,
      stuckMinutes: normalizedStuck,
      transactionId: transactionId.trim() || undefined,
    }
  }, [
    onChainId,
    page,
    pageSize,
    status,
    stuckMinutes,
    transactionId,
  ])

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
      const result = await listFlowInstances(query)
      setData(result)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flow instances')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey, query])

  const handleBulkRetry = useCallback(async () => {
    if (!opsApiKey || selectedIds.size === 0) return
    setBulkLoading(true)
    setBulkResult(null)
    setError(null)

    try {
      const result = await bulkRetryFlowInstances(Array.from(selectedIds))
      setBulkResult(result)
      setSelectedIds(new Set())
      await fetchData()
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk retry failed')
    }
    finally {
      setBulkLoading(false)
    }
  }, [
    fetchData,
    opsApiKey,
    selectedIds,
  ])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="ops-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-abroad-dark">Operations</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Flow Control Room</h1>
              <p className="text-sm text-gray-600 max-w-xl mt-2">
                Monitor corridor executions, inspect step-level telemetry, and intervene when flows stall.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                className="ops-nav-link"
                to="/ops/flows/definitions"
              >
                Edit Definitions
              </Link>
              <Link
                className="ops-nav-link"
                to="/ops/crypto-assets"
              >
                Crypto Assets
              </Link>
              <Link
                className="ops-nav-link"
                to="/ops/partners"
              >
                Partners
              </Link>
              <Link
                className="ops-nav-link"
                to="/ops/transactions"
              >
                Transactions
              </Link>
              <Link
                className="ops-nav-link"
                to="/ops/treasury/bridge"
              >
                Bridge
              </Link>
              <Link
                className="ops-nav-link"
                to="/ops/transactions/reconcile"
              >
                Reconcile Hash
              </Link>
              <button
                className="ops-btn-ghost"
                disabled={!opsApiKey}
                onClick={() => void fetchData()}
                type="button"
              >
                Refresh
              </button>
            </div>
          </div>

          <OpsApiKeyPanel />

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_2fr_1fr_1fr_1fr_auto] bg-white/70 backdrop-blur rounded-2xl border border-white/70 p-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
            <div className="flex flex-col">
              <label className="ops-label">Transaction ID</label>
              <input
                className="mt-2 ops-input"
                onChange={event => setTransactionId(event.target.value)}
                placeholder="UUID"
                value={transactionId}
              />
            </div>
            <div className="flex flex-col">
              <label className="ops-label">On-chain ID</label>
              <input
                className="mt-2 ops-input"
                onChange={event => setOnChainId(event.target.value)}
                placeholder="tx hash"
                value={onChainId}
              />
            </div>
            <div className="flex flex-col">
              <label className="ops-label">Status</label>
              <select
                className="mt-2 ops-input"
                onChange={event => setStatus(event.target.value as '' | FlowInstanceStatus)}
                value={status}
              >
                <option value="">All</option>
                {flowInstanceStatuses.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="ops-label">Stuck Minutes</label>
              <input
                className="mt-2 ops-input"
                onChange={event => setStuckMinutes(event.target.value)}
                placeholder="ex: 30"
                type="number"
                value={stuckMinutes}
              />
            </div>
            <div className="flex flex-col">
              <label className="ops-label">Page</label>
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="h-9 w-9 rounded-xl border border-ops-border bg-white text-lg disabled:opacity-40"
                  disabled={page <= 1}
                  onClick={() => setPage(current => Math.max(1, current - 1))}
                  type="button"
                >
                  ‹
                </button>
                <div className="text-sm font-medium">
                  {page}
                  {' '}
                  /
                  {' '}
                  {totalPages}
                </div>
                <button
                  className="h-9 w-9 rounded-xl border border-ops-border bg-white text-lg disabled:opacity-40"
                  disabled={page >= totalPages}
                  onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                  type="button"
                >
                  ›
                </button>
              </div>
            </div>
            <div className="flex items-end">
              <button
                className="w-full rounded-xl border border-abroad-dark bg-abroad-dark px-4 py-2 text-white text-sm font-medium hover:bg-ops-brand-hover transition"
                onClick={() => {
                  setPage(1)
                  void fetchData()
                }}
                type="button"
              >
                Apply
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          {!opsApiKey && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to load flow instances.
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-abroad-dark/30 bg-white/80 px-5 py-4 shadow-[0_15px_45px_-35px_rgba(15,23,42,0.5)] md:flex-row md:items-center md:justify-between">
              <div className="text-sm font-medium text-gray-800">
                {selectedIds.size}
                {' '}
                flow
                {selectedIds.size === 1 ? '' : 's'}
                {' '}
                selected
                <span className="ml-2 text-xs text-gray-500">Retries the earliest failed step of each.</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  className="rounded-xl border border-ops-border bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  disabled={bulkLoading}
                  onClick={clearSelection}
                  type="button"
                >
                  Clear
                </button>
                <button
                  className="rounded-xl border border-abroad-dark bg-abroad-dark px-4 py-2 text-xs font-semibold text-white hover:bg-ops-brand-hover disabled:opacity-40"
                  disabled={bulkLoading || !opsApiKey}
                  onClick={() => void handleBulkRetry()}
                  type="button"
                >
                  {bulkLoading ? 'Retrying...' : `Retry ${selectedIds.size} selected`}
                </button>
              </div>
            </div>
          )}

          {bulkResult && (
            <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 px-5 py-4 text-sm shadow-[0_15px_45px_-35px_rgba(15,23,42,0.5)]">
              <div className="font-medium text-gray-800">
                Bulk retry:
                {' '}
                <span className="text-emerald-700">{bulkResult.succeeded}</span>
                {' '}
                succeeded ·
                {' '}
                <span className="text-rose-700">{bulkResult.failed}</span>
                {' '}
                failed
              </div>
              {bulkResult.failed > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-rose-700">
                  {bulkResult.results.filter(item => !item.ok).map(item => (
                    <li className="break-all" key={item.flowInstanceId}>
                      {item.flowInstanceId}
                      :
                      {' '}
                      {item.error ?? 'failed'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-8 space-y-4">
            {loading && opsApiKey && (
              <div className="text-sm text-ops-label">Loading flows...</div>
            )}

            {!loading && opsApiKey && data?.items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/70 px-6 py-12 text-center text-sm text-gray-500">
                No flow instances match the current filters.
              </div>
            )}

            {data?.items.map(instance => (
              <div className="flex items-start gap-3" key={instance.id}>
                <input
                  aria-label={`Select flow ${instance.id}`}
                  checked={selectedIds.has(instance.id)}
                  className="mt-6 h-4 w-4 shrink-0 rounded border-ops-border"
                  onChange={() => toggleSelection(instance.id)}
                  type="checkbox"
                />
                <button
                  className="flex-1 text-left rounded-2xl border border-white/80 bg-white/80 backdrop-blur px-6 py-4 shadow-[0_15px_45px_-35px_rgba(15,23,42,0.5)] hover:shadow-[0_20px_55px_-35px_rgba(15,23,42,0.55)] transition"
                  onClick={() => navigate(`/ops/flows/${instance.id}`)}
                  type="button"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[instance.status]}`}>
                          {instance.status}
                        </span>
                        <span className="text-xs uppercase tracking-wider text-slate-500">{instance.definition?.name ?? 'Unlabeled flow'}</span>
                      </div>
                      <div className="mt-2 text-lg font-semibold">
                        {instance.definition?.cryptoCurrency ?? '—'}
                        {' '}
                        ·
                        {instance.definition?.blockchain ?? '—'}
                        {' '}
                        →
                        {instance.definition?.targetCurrency ?? '—'}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        Updated
                        {' '}
                        {formatDate(instance.updatedAt)}
                        {' '}
                        · Transaction
                        {' '}
                        {instance.transactionId}
                      </div>
                      {instance.transaction?.onChainId && (
                        <div className="mt-1 text-xs text-slate-400 break-all">
                          On-chain
                          {' '}
                          {instance.transaction.onChainId}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-start gap-2 text-sm text-gray-800">
                      <div className="font-medium">Step Pulse</div>
                      <div className="text-xs text-gray-500">{buildStepSummary(instance.stepSummary)}</div>
                      {instance.currentStep && (
                        <div className="text-xs text-gray-500">
                          Current:
                          {instance.currentStep.stepType}
                          {' '}
                          (#
                          {instance.currentStep.stepOrder}
                          )
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FlowOpsList
