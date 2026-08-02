import {
  AlertTriangle,
  ArrowRight,
  FilterX,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type {
  FlowBulkRetryResponse,
  FlowInstanceListResponse,
  FlowInstanceStatus,
  FlowStepSummary,
} from '../../services/admin/flowTypes'
import type { OpsSavedView, OpsSavedViewFilters } from '../../services/admin/opsInvestigationTypes'

import { bulkRetryFlowInstances, listFlowInstances } from '../../services/admin/flowAdminApi'
import { flowInstanceStatuses } from '../../services/admin/flowTypes'
import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  createOpsSavedView,
  deleteOpsSavedView,
  listOpsSavedViews,
  updateOpsSavedView,
} from '../../services/admin/opsInvestigationApi'
import {
  emptyFlowFilterDraft,
  flowDraftToParams,
  FlowFilterDraft,
  readFlowFilterDraft,
  readFlowPage,
  toFlowFilters,
} from './flows/flowFilterState'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
  OpsTone,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'
import SavedViewsBar from './transactions/SavedViewsBar'

const statusTone: Readonly<Record<FlowInstanceStatus, OpsTone>> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  IN_PROGRESS: 'info',
  NOT_STARTED: 'neutral',
  WAITING: 'warning',
}

const buildStepSummary = (summary: FlowStepSummary): string => {
  const parts = [
    summary.failed ? `${summary.failed} failed` : null,
    summary.running ? `${summary.running} running` : null,
    summary.waiting ? `${summary.waiting} waiting` : null,
    summary.ready ? `${summary.ready} ready` : null,
    summary.succeeded ? `${summary.succeeded} complete` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : 'No execution steps recorded'
}

const filtersFromSavedView = (filters: OpsSavedViewFilters): FlowFilterDraft => {
  const params = new URLSearchParams()
  const values: Readonly<Record<keyof FlowFilterDraft, number | string | undefined>> = {
    blockchain: filters.blockchain,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo,
    cryptoCurrency: filters.cryptoCurrency,
    failure: filters.failure,
    onChainId: filters.onChainId,
    partnerId: filters.partnerId,
    payoutProvider: filters.payoutProvider,
    status: filters.status,
    stuckMinutes: filters.stuckMinutes,
    targetCurrency: filters.targetCurrency,
    transactionId: filters.transactionId,
  }
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value))
  })
  return readFlowFilterDraft(params)
}

const FlowOpsList = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const appliedDraft = useMemo(
    () => readFlowFilterDraft(new URLSearchParams(paramsKey)),
    [paramsKey],
  )
  const page = useMemo(() => readFlowPage(new URLSearchParams(paramsKey)), [paramsKey])
  const [draft, setDraft] = useState(appliedDraft)
  const [data, setData] = useState<FlowInstanceListResponse | null>(null)
  const [savedViews, setSavedViews] = useState<OpsSavedView[]>([])
  const [loading, setLoading] = useState(false)
  const [savedViewLoading, setSavedViewLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkResult, setBulkResult] = useState<FlowBulkRetryResponse | null>(null)
  const pageSize = 20
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const appliedFilters = useMemo(
    () => toFlowFilters(appliedDraft, page, pageSize),
    [appliedDraft, page],
  )
  const canRecover = Boolean(session?.kind === 'ops_user' && session.permissions.includes('flows:recover'))
  const canManageSavedViews = Boolean(session?.kind === 'ops_user' && session.permissions.includes('saved_views:manage'))

  useEffect(() => setDraft(appliedDraft), [appliedDraft])

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!opsApiKey) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await listFlowInstances(appliedFilters, signal))
    }
    catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : 'Failed to load flow operations')
    }
    finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [appliedFilters, opsApiKey])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    if (!opsApiKey || session?.kind !== 'ops_user') {
      setSavedViews([])
      return undefined
    }
    let active = true
    void listOpsSavedViews('FLOWS')
      .then((views) => {
        if (active) setSavedViews(views)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Flow saved views are unavailable')
      })
    return () => {
      active = false
    }
  }, [opsApiKey, session?.kind])

  const changeDraft = <TKey extends keyof FlowFilterDraft>(key: TKey, value: FlowFilterDraft[TKey]): void => {
    setDraft(current => ({ ...current, [key]: value }))
  }
  const applyDraft = (): void => setSearchParams(flowDraftToParams(draft))
  const resetFilters = (): void => {
    setDraft(emptyFlowFilterDraft)
    setSearchParams(new URLSearchParams())
  }
  const changePage = (nextPage: number): void => setSearchParams(flowDraftToParams(appliedDraft, nextPage))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const toggleSelection = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkRetry = async (): Promise<void> => {
    if (!canRecover || selectedIds.size === 0) return
    setBulkLoading(true)
    setBulkResult(null)
    setError(null)
    try {
      const flowInstanceIds = Array.from(selectedIds)
      const result = await requestMutation({
        action: 'flow.bulk_retry',
        execute: mutation => bulkRetryFlowInstances(flowInstanceIds, mutation),
        resourceLabel: `${flowInstanceIds.length} selected production flows`,
        title: 'Retry failed flows',
      })
      setBulkResult(result)
      setSelectedIds(new Set())
      await load()
    }
    catch (retryError) {
      if (!isOpsMutationCancelledError(retryError)) {
        setError(retryError instanceof Error ? retryError.message : 'Bulk retry failed')
      }
    }
    finally {
      setBulkLoading(false)
    }
  }

  const currentSavedFilters = (): OpsSavedViewFilters => ({
    blockchain: appliedFilters.blockchain,
    createdFrom: appliedFilters.createdFrom,
    createdTo: appliedFilters.createdTo,
    cryptoCurrency: appliedFilters.cryptoCurrency,
    failure: appliedFilters.failure,
    onChainId: appliedFilters.onChainId,
    pageSize,
    partnerId: appliedFilters.partnerId,
    payoutProvider: appliedFilters.payoutProvider,
    status: appliedFilters.status,
    stuckMinutes: appliedFilters.stuckMinutes,
    targetCurrency: appliedFilters.targetCurrency,
    transactionId: appliedFilters.transactionId,
  })

  const createSavedView = async (input: { name: string, scope: 'PRIVATE' | 'TEAM' }): Promise<void> => {
    setSavedViewLoading(true)
    try {
      const created = await requestMutation({
        action: 'saved_view.create',
        execute: mutation => createOpsSavedView({
          filters: currentSavedFilters(),
          name: input.name,
          resource: 'FLOWS',
          scope: input.scope,
        }, mutation),
        resourceLabel: input.name,
        title: 'Save flow view',
      })
      setSavedViews(current => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) {
        setError(saveError instanceof Error ? saveError.message : 'Failed to save the flow view')
      }
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const updateSavedView = async (view: OpsSavedView): Promise<void> => {
    setSavedViewLoading(true)
    try {
      const updated = await requestMutation({
        action: 'saved_view.update',
        execute: mutation => updateOpsSavedView(view.id, { filters: currentSavedFilters() }, mutation),
        expectedVersion: view.version,
        resourceLabel: view.name,
        title: 'Replace flow saved-view filters',
      })
      setSavedViews(current => current.map(item => item.id === updated.id ? updated : item))
    }
    catch (updateError) {
      if (!isOpsMutationCancelledError(updateError)) {
        setError(updateError instanceof Error ? updateError.message : 'Failed to update the flow view')
      }
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const deleteSavedView = async (view: OpsSavedView): Promise<void> => {
    setSavedViewLoading(true)
    try {
      await requestMutation({
        action: 'saved_view.delete',
        execute: mutation => deleteOpsSavedView(view.id, mutation),
        expectedVersion: view.version,
        resourceLabel: view.name,
        title: 'Delete flow saved view',
      })
      setSavedViews(current => current.filter(item => item.id !== view.id))
    }
    catch (deleteError) {
      if (!isOpsMutationCancelledError(deleteError)) {
        setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete the flow view')
      }
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost min-h-11" disabled={!opsApiKey || loading} onClick={() => void load()} type="button">
          <RefreshCw aria-hidden size={16} />
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Work · Flows"
      keyRequiredMessage="Sign in to review flow execution."
      subtitle="Find stalled corridor executions, inspect their transaction context, and recover only after reviewing step evidence."
      title="Flow operations"
      width="full"
    >
      <section aria-labelledby="flow-filters-title" className="ops-card mt-7 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="ops-label" id="flow-filters-title">Applied only when you choose Apply filters</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OpsField label="Transaction ID">
                <input className="ops-input min-h-11" onChange={event => changeDraft('transactionId', event.target.value)} placeholder="Exact Abroad ID" value={draft.transactionId} />
              </OpsField>
              <OpsField label="On-chain ID">
                <input className="ops-input min-h-11" onChange={event => changeDraft('onChainId', event.target.value)} placeholder="Exact hash or signature" value={draft.onChainId} />
              </OpsField>
              <OpsField label="Partner ID">
                <input className="ops-input min-h-11" onChange={event => changeDraft('partnerId', event.target.value)} placeholder="Exact partner ID" value={draft.partnerId} />
              </OpsField>
              <OpsField label="Execution status">
                <select className="ops-input min-h-11" onChange={event => changeDraft('status', event.target.value as FlowFilterDraft['status'])} value={draft.status}>
                  <option value="">All statuses</option>
                  {flowInstanceStatuses.map(status => <option key={status} value={status}>{humanizeStatus(status)}</option>)}
                </select>
              </OpsField>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="ops-btn-neutral min-h-11" onClick={resetFilters} type="button">
              <FilterX aria-hidden size={16} />
              Clear
            </button>
            <button className="ops-btn-primary min-h-11" disabled={loading} onClick={applyDraft} type="button">Apply filters</button>
          </div>
        </div>

        <details className="mt-4 border-t border-ops-border pt-4">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ops-brand">Corridor, date, and failure filters</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <OpsField label="Created from"><input className="ops-input min-h-11" onChange={event => changeDraft('createdFrom', event.target.value)} type="date" value={draft.createdFrom} /></OpsField>
            <OpsField label="Created to"><input className="ops-input min-h-11" onChange={event => changeDraft('createdTo', event.target.value)} type="date" value={draft.createdTo} /></OpsField>
            <OpsField label="Payout provider">
              <select className="ops-input min-h-11" onChange={event => changeDraft('payoutProvider', event.target.value as FlowFilterDraft['payoutProvider'])} value={draft.payoutProvider}>
                <option value="">All providers</option>
                <option value="PIX">PIX</option>
                <option value="BREB">Bre-B</option>
              </select>
            </OpsField>
            <OpsField label="Stablecoin">
              <select className="ops-input min-h-11" onChange={event => changeDraft('cryptoCurrency', event.target.value as FlowFilterDraft['cryptoCurrency'])} value={draft.cryptoCurrency}>
                <option value="">All stablecoins</option>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </select>
            </OpsField>
            <OpsField label="Network">
              <select className="ops-input min-h-11" onChange={event => changeDraft('blockchain', event.target.value as FlowFilterDraft['blockchain'])} value={draft.blockchain}>
                <option value="">All networks</option>
                <option value="STELLAR">Stellar</option>
                <option value="SOLANA">Solana</option>
                <option value="CELO">Celo</option>
              </select>
            </OpsField>
            <OpsField label="Payout currency">
              <select className="ops-input min-h-11" onChange={event => changeDraft('targetCurrency', event.target.value as FlowFilterDraft['targetCurrency'])} value={draft.targetCurrency}>
                <option value="">All currencies</option>
                <option value="BRL">BRL</option>
                <option value="COP">COP</option>
              </select>
            </OpsField>
            <OpsField label="Failure dimension">
              <select className="ops-input min-h-11" onChange={event => changeDraft('failure', event.target.value as FlowFilterDraft['failure'])} value={draft.failure}>
                <option value="">All execution states</option>
                <option value="FAILED_FLOW">Failed flow</option>
                <option value="FAILED_STEP">Failed step</option>
                <option value="STUCK_WAITING">Waiting over threshold</option>
              </select>
            </OpsField>
            <OpsField hint="When set, returns waiting flows older than this threshold." label="Waiting threshold (minutes)">
              <input className="ops-input min-h-11" min="1" onChange={event => changeDraft('stuckMinutes', event.target.value)} placeholder="30" type="number" value={draft.stuckMinutes} />
            </OpsField>
          </div>
        </details>
      </section>

      {session?.kind === 'ops_user' && (
        <SavedViewsBar
          canManage={canManageSavedViews}
          loading={savedViewLoading}
          onApply={(view) => {
            const next = filtersFromSavedView(view.filters)
            setDraft(next)
            setSearchParams(flowDraftToParams(next))
          }}
          onCreate={createSavedView}
          onDelete={deleteSavedView}
          onUpdate={updateSavedView}
          resourceName="flows"
          views={savedViews}
        />
      )}

      {data && (
        <section aria-label="Flow status counts" className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {data.statusCounts.map(item => (
            <button
              className={`min-h-14 rounded-xl border px-3 py-2 text-left ${appliedDraft.status === item.status ? 'border-ops-brand bg-emerald-50' : 'border-ops-border bg-white hover:border-ops-brand/50'}`}
              key={item.status}
              onClick={() => {
                const next = { ...appliedDraft, status: appliedDraft.status === item.status ? '' as const : item.status }
                setDraft(next)
                setSearchParams(flowDraftToParams(next))
              }}
              type="button"
            >
              <span className="block text-lg font-semibold text-ops-text">{item.count}</span>
              <span className="block truncate text-[11px] font-medium text-ops-muted">{humanizeStatus(item.status)}</span>
            </button>
          ))}
        </section>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span aria-live="polite" className="text-sm text-ops-muted">
          {data ? `${data.total} matching flow${data.total === 1 ? '' : 's'}` : ''}
          {loading && data ? ' · Refreshing' : ''}
        </span>
        <OpsPagination loading={loading} onChange={changePage} page={page} totalPages={totalPages} />
      </div>

      {selectedIds.size > 0 && (
        <section aria-label="Selected flow recovery" className="ops-card mt-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-ops-text">
              {selectedIds.size}
              {' '}
              failed flow
              {selectedIds.size === 1 ? '' : 's'}
              {' '}
              selected
            </p>
            <p className="mt-1 text-xs text-ops-muted">Retry starts at each flow's earliest failed step after confirmation.</p>
          </div>
          <div className="flex gap-2">
            <button className="ops-btn-neutral min-h-11" onClick={() => setSelectedIds(new Set())} type="button">Clear</button>
            <button className="ops-btn-primary min-h-11" disabled={!canRecover || bulkLoading} onClick={() => void handleBulkRetry()} type="button">
              <RotateCcw aria-hidden size={16} />
              {bulkLoading ? 'Retrying…' : 'Review retry'}
            </button>
          </div>
        </section>
      )}

      {bulkResult && (
        <OpsBanner className="mt-4" variant={bulkResult.failed > 0 ? 'warning' : 'success'}>
          Recovery finished:
          {' '}
          {bulkResult.succeeded}
          {' '}
          succeeded and
          {' '}
          {bulkResult.failed}
          {' '}
          failed. Open each remaining flow for evidence and next-step guidance.
        </OpsBanner>
      )}

      <div aria-busy={loading} className="mt-4 space-y-3">
        {loading && !data && opsApiKey && <OpsLoading label="Loading flow operations…" />}
        {!loading && opsApiKey && data?.items.length === 0 && (
          <OpsEmptyState>
            <div>
              <p className="font-semibold text-ops-text">No flows match these applied filters.</p>
              <button className="mt-3 font-semibold text-ops-brand underline underline-offset-4" onClick={resetFilters} type="button">Clear filters</button>
            </div>
          </OpsEmptyState>
        )}
        {data?.items.map(instance => (
          <article className="ops-card-interactive overflow-hidden" key={instance.id}>
            <div className="flex items-stretch">
              {instance.status === 'FAILED' && (
                <label className="flex min-w-12 cursor-pointer items-start justify-center border-r border-ops-border px-3 py-5">
                  <span className="sr-only">
                    Select failed flow
                    {instance.id}
                  </span>
                  <input checked={selectedIds.has(instance.id)} className="mt-1 h-5 w-5 accent-ops-brand" onChange={() => toggleSelection(instance.id)} type="checkbox" />
                </label>
              )}
              <Link className="group min-w-0 flex-1 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ops-brand" to={`/ops/flows/${instance.id}`}>
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OpsStatusBadge label={humanizeStatus(instance.status)} tone={statusTone[instance.status]} />
                      {instance.stepSummary.failed > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                          <AlertTriangle aria-hidden size={14} />
                          Failed step
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 text-lg font-semibold text-ops-text">{instance.definition?.name ?? 'Unlabeled corridor execution'}</h2>
                    <p className="mt-1 text-sm text-ops-muted">
                      {instance.transaction?.partner.name ?? 'Unknown partner'}
                      {' '}
                      ·
                      {instance.definition?.cryptoCurrency ?? 'Unknown asset'}
                      {' '}
                      on
                      {humanizeStatus(instance.definition?.blockchain ?? 'unknown network')}
                      {' '}
                      →
                      {instance.definition?.targetCurrency ?? 'Unknown payout'}
                      {' '}
                      via
                      {humanizeStatus(instance.definition?.payoutProvider ?? 'unknown provider')}
                    </p>
                    <p className="mt-3 text-xs text-ops-muted">
                      Updated
                      {formatDateTime(instance.updatedAt)}
                      {' '}
                      ·
                      {buildStepSummary(instance.stepSummary)}
                    </p>
                  </div>
                  <div className="shrink-0 lg:text-right">
                    <p className="ops-label">Current execution step</p>
                    <p className="mt-1 text-sm font-semibold text-ops-text">
                      {instance.currentStep ? humanizeStatus(instance.currentStep.stepType) : 'No active step'}
                    </p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ops-brand">
                      Inspect evidence
                      <ArrowRight aria-hidden className="transition-transform group-hover:translate-x-0.5" size={16} />
                    </span>
                  </div>
                </div>
                <p className="mt-4 break-all border-t border-ops-border pt-3 font-mono text-[11px] text-ops-muted">
                  Flow
                  {instance.id}
                  {' '}
                  · Transaction
                  {instance.transactionId}
                </p>
              </Link>
            </div>
          </article>
        ))}
      </div>
    </OpsPageShell>
  )
}

export default FlowOpsList
