import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { searchTransactions } from '../../services/admin/transactionAdminApi'
import {
  OpsTransactionListResponse,
  TransactionStatus,
  transactionStatuses,
} from '../../services/admin/transactionAdminTypes'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const statusClasses: Record<TransactionStatus, string> = {
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800 border-amber-200',
  PAYMENT_COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  PAYMENT_EXPIRED: 'bg-slate-100 text-slate-600 border-slate-200',
  PAYMENT_FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  PROCESSING_PAYMENT: 'bg-sky-100 text-sky-800 border-sky-200',
  WRONG_AMOUNT: 'bg-rose-100 text-rose-800 border-rose-200',
}

const formatDate = (value: string) => new Date(value).toLocaleString()

const TransactionsList = () => {
  const navigate = useNavigate()
  const [data, setData] = useState<null | OpsTransactionListResponse>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [status, setStatus] = useState<'' | TransactionStatus>('')
  const [partnerId, setPartnerId] = useState('')
  const [userId, setUserId] = useState('')
  const [onChainId, setOnChainId] = useState('')
  const [externalId, setExternalId] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const opsApiKey = useOpsApiKey()

  const query = useMemo(() => ({
    externalId: externalId.trim() || undefined,
    onChainId: onChainId.trim() || undefined,
    page,
    pageSize,
    partnerId: partnerId.trim() || undefined,
    status: status || undefined,
    userId: userId.trim() || undefined,
  }), [
    externalId,
    onChainId,
    page,
    partnerId,
    status,
    userId,
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
      const result = await searchTransactions(query)
      setData(result)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey, query])

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
              <div className="flex items-center gap-3 text-sm">
                <Link className="text-ops-brand hover:text-abroad-dark" to="/ops/flows">← Flows</Link>
                <Link className="text-ops-brand hover:text-abroad-dark" to="/ops/treasury/bridge">Bridge</Link>
                <Link className="text-ops-brand hover:text-abroad-dark" to="/ops/transactions/reconcile">Reconcile hash</Link>
              </div>
              <div className="mt-3 text-sm uppercase tracking-[0.3em] text-abroad-dark">Operations</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Transactions</h1>
              <p className="text-sm text-gray-600 max-w-xl mt-2">
                Look up transactions by status, partner, user, on-chain hash, or external id.
              </p>
            </div>
            <button
              className="ops-btn-ghost"
              disabled={!opsApiKey}
              onClick={() => void fetchData()}
              type="button"
            >
              Refresh
            </button>
          </div>

          <OpsApiKeyPanel />

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3 bg-white/70 backdrop-blur rounded-2xl border border-white/70 p-4 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
            <div className="flex flex-col">
              <label className="ops-label">Status</label>
              <select
                className="mt-2 ops-input"
                onChange={event => setStatus(event.target.value as '' | TransactionStatus)}
                value={status}
              >
                <option value="">All</option>
                {transactionStatuses.map(item => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="ops-label">Partner ID</label>
              <input
                className="mt-2 ops-input"
                onChange={event => setPartnerId(event.target.value)}
                placeholder="partner UUID"
                value={partnerId}
              />
            </div>
            <div className="flex flex-col">
              <label className="ops-label">User ID</label>
              <input
                className="mt-2 ops-input"
                onChange={event => setUserId(event.target.value)}
                placeholder="partner user id"
                value={userId}
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
              <label className="ops-label">External ID</label>
              <input
                className="mt-2 ops-input"
                onChange={event => setExternalId(event.target.value)}
                placeholder="provider external id"
                value={externalId}
              />
            </div>
            <div className="flex items-end">
              <button
                className="w-full rounded-xl border border-abroad-dark bg-abroad-dark px-4 py-2 text-white text-sm font-medium hover:bg-ops-brand-hover transition"
                onClick={() => setPage(1)}
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
              Ops API key required to load transactions.
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {data ? `${data.total} result${data.total === 1 ? '' : 's'}` : ''}
            </div>
            <div className="flex items-center gap-2">
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

          <div className="mt-4 space-y-3">
            {loading && opsApiKey && (
              <div className="text-sm text-ops-label">Loading transactions...</div>
            )}
            {!loading && opsApiKey && data?.items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/70 px-6 py-12 text-center text-sm text-gray-500">
                No transactions match the current filters.
              </div>
            )}
            {data?.items.map(transaction => (
              <button
                className="w-full text-left rounded-2xl border border-white/80 bg-white/80 backdrop-blur px-6 py-4 shadow-[0_15px_45px_-35px_rgba(15,23,42,0.5)] hover:shadow-[0_20px_55px_-35px_rgba(15,23,42,0.55)] transition"
                key={transaction.id}
                onClick={() => navigate(`/ops/transactions/${transaction.id}`)}
                type="button"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses[transaction.status]}`}>
                        {transaction.status}
                      </span>
                      <span className="text-xs uppercase tracking-wider text-slate-500">
                        {transaction.quote.cryptoCurrency}
                        {' '}
                        ·
                        {' '}
                        {transaction.quote.network}
                        {' → '}
                        {transaction.quote.targetCurrency}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-semibold break-all">{transaction.id}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Created
                      {' '}
                      {formatDate(transaction.createdAt)}
                      {' '}
                      · Partner
                      {' '}
                      {transaction.partnerId}
                      {' '}
                      · User
                      {' '}
                      {transaction.userId}
                    </div>
                    {transaction.onChainId && (
                      <div className="mt-1 text-xs text-slate-400 break-all">
                        On-chain
                        {' '}
                        {transaction.onChainId}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm text-gray-800">
                    <div className="font-semibold">
                      {transaction.quote.targetAmount}
                      {' '}
                      {transaction.quote.targetCurrency}
                    </div>
                    <div className="text-xs text-gray-500">
                      {transaction.quote.sourceAmount}
                      {' '}
                      {transaction.quote.cryptoCurrency}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TransactionsList
