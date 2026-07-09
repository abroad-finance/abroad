import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link } from 'react-router-dom'

import { bulkRetryFlowInstances, listFlowInstances } from '../../services/admin/flowAdminApi'
import {
  FlowBulkRetryResponse,
  FlowInstanceListResponse,
  FlowInstanceStatus,
  flowInstanceStatuses,
  FlowStepSummary,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatDateTime,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
  OpsTone,
} from './shared'

const statusTone: Record<FlowInstanceStatus, OpsTone> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  IN_PROGRESS: 'info',
  NOT_STARTED: 'neutral',
  WAITING: 'warning',
}

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
      keyRequiredMessage="Ops API key required to load flow instances."
      subtitle="Monitor corridor executions, inspect step-level telemetry, and intervene when flows stall."
      title="Flow Control Room"
    >
      <div className="ops-card mt-8 grid grid-cols-1 gap-4 p-4 lg:grid-cols-[2fr_2fr_1fr_1fr_auto]">
        <OpsField label="Transaction ID">
          <input
            className="ops-input"
            onChange={event => setTransactionId(event.target.value)}
            placeholder="UUID"
            value={transactionId}
          />
        </OpsField>
        <OpsField label="On-chain ID">
          <input
            className="ops-input"
            onChange={event => setOnChainId(event.target.value)}
            placeholder="tx hash"
            value={onChainId}
          />
        </OpsField>
        <OpsField label="Status">
          <select
            className="ops-input"
            onChange={event => setStatus(event.target.value as '' | FlowInstanceStatus)}
            value={status}
          >
            <option value="">All</option>
            {flowInstanceStatuses.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </OpsField>
        <OpsField label="Stuck Minutes">
          <input
            className="ops-input"
            onChange={event => setStuckMinutes(event.target.value)}
            placeholder="ex: 30"
            type="number"
            value={stuckMinutes}
          />
        </OpsField>
        <div className="flex items-end">
          <button
            className="ops-btn-primary w-full"
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

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-xs text-ops-muted">
          {data ? `${data.total} flow${data.total === 1 ? '' : 's'}` : ''}
        </div>
        <OpsPagination
          loading={loading}
          onChange={setPage}
          page={page}
          totalPages={totalPages}
        />
      </div>

      {selectedIds.size > 0 && (
        <div className="ops-card mt-4 flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-medium text-ops-text">
            {selectedIds.size}
            {' '}
            flow
            {selectedIds.size === 1 ? '' : 's'}
            {' '}
            selected
            <span className="ml-2 text-xs text-ops-muted">Retries the earliest failed step of each.</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="ops-btn-neutral ops-btn-sm"
              disabled={bulkLoading}
              onClick={clearSelection}
              type="button"
            >
              Clear
            </button>
            <button
              className="ops-btn-primary ops-btn-sm"
              disabled={bulkLoading || !opsApiKey}
              onClick={() => void handleBulkRetry()}
              type="button"
            >
              {bulkLoading ? 'Retrying…' : `Retry ${selectedIds.size} selected`}
            </button>
          </div>
        </div>
      )}

      {bulkResult && (
        <div className="ops-card mt-4 px-5 py-4 text-sm">
          <div className="font-medium text-ops-text">
            Bulk retry:
            {' '}
            <span className="font-semibold text-emerald-700">{bulkResult.succeeded}</span>
            {' '}
            succeeded ·
            {' '}
            <span className="font-semibold text-rose-700">{bulkResult.failed}</span>
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
          <OpsLoading label="Loading flows…" />
        )}

        {!loading && opsApiKey && data?.items.length === 0 && (
          <OpsEmptyState>No flow instances match the current filters.</OpsEmptyState>
        )}

        {data?.items.map(instance => (
          <div className="flex items-start gap-3" key={instance.id}>
            <input
              aria-label={`Select flow ${instance.id}`}
              checked={selectedIds.has(instance.id)}
              className="mt-6 h-4 w-4 shrink-0 rounded border-ops-border accent-ops-brand"
              onChange={() => toggleSelection(instance.id)}
              type="checkbox"
            />
            <Link
              className="ops-card-interactive flex-1 px-6 py-4 text-left"
              to={`/ops/flows/${instance.id}`}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <OpsStatusBadge label={instance.status} tone={statusTone[instance.status]} />
                    <span className="text-xs uppercase tracking-wider text-ops-muted">{instance.definition?.name ?? 'Unlabeled flow'}</span>
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
                  <div className="mt-1 text-sm text-ops-muted">
                    Updated
                    {' '}
                    {formatDateTime(instance.updatedAt)}
                    {' '}
                    · Transaction
                    {' '}
                    {instance.transactionId}
                  </div>
                  {instance.transaction?.onChainId && (
                    <div className="mt-1 break-all text-xs text-ops-muted">
                      On-chain
                      {' '}
                      {instance.transaction.onChainId}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-start gap-2 text-sm text-ops-text">
                  <div className="font-medium">Step Pulse</div>
                  <div className="text-xs text-ops-muted">{buildStepSummary(instance.stepSummary)}</div>
                  {instance.currentStep && (
                    <div className="text-xs text-ops-muted">
                      Current:
                      {' '}
                      {instance.currentStep.stepType}
                      {' '}
                      (#
                      {instance.currentStep.stepOrder}
                      )
                    </div>
                  )}
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </OpsPageShell>
  )
}

export default FlowOpsList
