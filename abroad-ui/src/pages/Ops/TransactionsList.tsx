import { Download, Search, Siren } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { OpsSavedView } from '../../services/admin/opsInvestigationTypes'
import type { OpsTransactionListResponse } from '../../services/admin/transactionAdminTypes'

import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  createOpsSavedView,
  deleteOpsSavedView,
  listOpsCaseOwners,
  listOpsSavedViews,
  updateOpsSavedView,
} from '../../services/admin/opsInvestigationApi'
import {
  exportFilteredTransactionEvidence,
  searchTransactions,
} from '../../services/admin/transactionAdminApi'
import {
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'
import SavedViewsBar from './transactions/SavedViewsBar'
import TransactionFiltersPanel from './transactions/TransactionFiltersPanel'
import {
  emptyTransactionFilterDraft,
  readTransactionFilterDraft,
  readTransactionPage,
  toTransactionFilters,
  transactionDraftToParams,
  transactionFiltersToDraft,
} from './transactions/transactionFilterState'
import TransactionSummaryCard from './transactions/TransactionSummaryCard'

const TransactionsList = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const paramsKey = searchParams.toString()
  const appliedDraft = useMemo(
    () => readTransactionFilterDraft(new URLSearchParams(paramsKey)),
    [paramsKey],
  )
  const page = useMemo(
    () => readTransactionPage(new URLSearchParams(paramsKey)),
    [paramsKey],
  )
  const [draft, setDraft] = useState(appliedDraft)
  const [data, setData] = useState<null | OpsTransactionListResponse>(null)
  const [owners, setOwners] = useState<Awaited<ReturnType<typeof listOpsCaseOwners>>>([])
  const [savedViews, setSavedViews] = useState<OpsSavedView[]>([])
  const [loading, setLoading] = useState(false)
  const [savedViewLoading, setSavedViewLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const pageSize = 20
  const appliedFilters = useMemo(
    () => toTransactionFilters(appliedDraft, page, pageSize),
    [appliedDraft, page],
  )
  const canManageSavedViews = Boolean(session?.kind === 'ops_user' && session.permissions.includes('saved_views:manage'))
  const canExport = Boolean(session?.kind === 'ops_user' && session.permissions.includes('transactions:export'))

  useEffect(() => {
    setDraft(appliedDraft)
  }, [appliedDraft])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!opsApiKey) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await searchTransactions(appliedFilters, signal))
    }
    catch (loadError) {
      if (signal?.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Failed to load transactions')
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
      setOwners([])
      setSavedViews([])
      return undefined
    }
    const controller = new AbortController()
    void Promise.all([listOpsCaseOwners(), listOpsSavedViews('TRANSACTIONS')])
      .then(([nextOwners, nextViews]) => {
        if (!controller.signal.aborted) {
          setOwners(nextOwners)
          setSavedViews(nextViews)
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Saved investigation tools are unavailable')
        }
      })
    return () => controller.abort()
  }, [opsApiKey, session?.kind])

  const applyDraft = (): void => setSearchParams(transactionDraftToParams(draft))
  const resetFilters = (): void => {
    setDraft(emptyTransactionFilterDraft)
    setSearchParams(new URLSearchParams())
  }
  const changePage = (nextPage: number): void => setSearchParams(transactionDraftToParams(appliedDraft, nextPage))
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const applySavedView = (view: OpsSavedView): void => {
    const nextDraft = transactionFiltersToDraft(view.filters)
    setDraft(nextDraft)
    setSearchParams(transactionDraftToParams(nextDraft))
  }

  const currentSavedFilters = (): OpsSavedView['filters'] => {
    const {
      page: ignoredPage,
      ...filters
    } = toTransactionFilters(appliedDraft, 1, pageSize)
    void ignoredPage
    return filters
  }

  const createSavedView = async (input: { name: string, scope: 'PRIVATE' | 'TEAM' }): Promise<void> => {
    setSavedViewLoading(true)
    setError(null)
    try {
      const created = await requestMutation({
        action: 'saved_view.create',
        execute: mutation => createOpsSavedView({
          filters: currentSavedFilters(),
          name: input.name,
          resource: 'TRANSACTIONS',
          scope: input.scope,
        }, mutation),
        resourceLabel: `${input.scope === 'TEAM' ? 'Team' : 'Private'} · ${input.name}`,
        title: 'Save transaction view',
      })
      setSavedViews(current => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) {
        setError(saveError instanceof Error ? saveError.message : 'Failed to save the view')
      }
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const updateSavedView = async (view: OpsSavedView): Promise<void> => {
    setSavedViewLoading(true)
    setError(null)
    try {
      const updated = await requestMutation({
        action: 'saved_view.update',
        execute: mutation => updateOpsSavedView(view.id, { filters: currentSavedFilters() }, mutation),
        expectedVersion: view.version,
        resourceLabel: view.name,
        title: 'Replace saved-view filters',
      })
      setSavedViews(current => current.map(item => item.id === updated.id ? updated : item))
    }
    catch (updateError) {
      if (!isOpsMutationCancelledError(updateError)) {
        setError(updateError instanceof Error ? updateError.message : 'Failed to update the view')
      }
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const deleteSavedView = async (view: OpsSavedView): Promise<void> => {
    setSavedViewLoading(true)
    setError(null)
    try {
      await requestMutation({
        action: 'saved_view.delete',
        execute: mutation => deleteOpsSavedView(view.id, mutation),
        expectedVersion: view.version,
        resourceLabel: view.name,
        title: 'Delete saved view',
      })
      setSavedViews(current => current.filter(item => item.id !== view.id))
    }
    catch (deleteError) {
      if (!isOpsMutationCancelledError(deleteError)) {
        setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete the view')
      }
    }
    finally {
      setSavedViewLoading(false)
    }
  }

  const exportEvidence = async (): Promise<void> => {
    setExportLoading(true)
    setError(null)
    try {
      const evidence = await exportFilteredTransactionEvidence(appliedFilters)
      const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.download = `abroad-ops-transaction-evidence-${new Date().toISOString().slice(0, 10)}.json`
      anchor.href = url
      anchor.click()
      URL.revokeObjectURL(url)
    }
    catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export transaction evidence')
    }
    finally {
      setExportLoading(false)
    }
  }

  return (
    <OpsPageShell
      actions={(
        <>
          <Link className="ops-btn-neutral min-h-11" to="/ops/search">
            <Search aria-hidden size={16} />
            Global search
          </Link>
          <Link className="ops-btn-ghost min-h-11" to="/ops/transactions/reconcile">
            <Siren aria-hidden size={16} />
            Reconciliation queue
          </Link>
          <button
            className="ops-btn-ghost min-h-11"
            disabled={!canExport || exportLoading}
            onClick={() => void exportEvidence()}
            type="button"
          >
            <Download aria-hidden size={16} />
            {exportLoading ? 'Exporting…' : 'Export applied view'}
          </button>
          <button className="ops-btn-ghost min-h-11" disabled={!opsApiKey || loading} onClick={() => void load()} type="button">Refresh</button>
        </>
      )}
      error={error}
      eyebrow="Work · Transactions"
      keyRequiredMessage="Sign in to investigate production transactions."
      subtitle="Search operational evidence across partners, apply shareable filters, and open a durable case when work needs ownership."
      title="Transaction investigations"
      width="full"
    >
      <TransactionFiltersPanel
        applied={appliedDraft}
        draft={draft}
        loading={loading}
        onApply={applyDraft}
        onChange={setDraft}
        onReset={resetFilters}
        owners={owners}
      />

      {session?.kind === 'ops_user' && (
        <SavedViewsBar
          canManage={canManageSavedViews}
          loading={savedViewLoading}
          onApply={applySavedView}
          onCreate={createSavedView}
          onDelete={deleteSavedView}
          onUpdate={updateSavedView}
          views={savedViews}
        />
      )}

      {data && (
        <section aria-label="Transaction status counts" className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {data.statusCounts.map(item => (
            <button
              className={`min-h-14 rounded-xl border px-3 py-2 text-left transition ${appliedDraft.status === item.status ? 'border-ops-brand bg-emerald-50' : 'border-ops-border bg-white hover:border-ops-brand/50'}`}
              key={item.status}
              onClick={() => {
                const next = { ...appliedDraft, status: appliedDraft.status === item.status ? '' as const : item.status }
                setDraft(next)
                setSearchParams(transactionDraftToParams(next))
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
        <div aria-live="polite" className="text-sm text-ops-muted">
          {data
            ? `${data.total.toLocaleString()} matching transaction${data.total === 1 ? '' : 's'}`
            : opsApiKey ? 'Preparing transaction results…' : ''}
          {loading && data ? ' · Refreshing' : ''}
        </div>
        <OpsPagination loading={loading} onChange={changePage} page={page} totalPages={totalPages} />
      </div>

      <div aria-busy={loading} className="mt-4 space-y-3">
        {loading && !data && opsApiKey && <OpsLoading label="Loading transaction investigations…" />}
        {!loading && opsApiKey && data?.items.length === 0 && (
          <OpsEmptyState>
            <div>
              <p className="font-semibold text-ops-text">No transactions match these applied filters.</p>
              <button className="mt-3 text-sm font-semibold text-ops-brand underline underline-offset-4" onClick={resetFilters} type="button">Clear filters and return to recent activity</button>
            </div>
          </OpsEmptyState>
        )}
        {data?.items.map(transaction => <TransactionSummaryCard key={transaction.id} transaction={transaction} />)}
      </div>

      {data && data.items.length > 0 && (
        <div className="mt-5 flex justify-end">
          <OpsPagination loading={loading} onChange={changePage} page={page} totalPages={totalPages} />
        </div>
      )}
    </OpsPageShell>
  )
}

export default TransactionsList
