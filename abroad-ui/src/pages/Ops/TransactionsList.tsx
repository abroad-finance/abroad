import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link } from 'react-router-dom'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { searchTransactions } from '../../services/admin/transactionAdminApi'
import {
  OpsTransactionListResponse,
  TransactionStatus,
  transactionStatuses,
} from '../../services/admin/transactionAdminTypes'
import {
  formatAmount,
  formatDateTime,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsPagination,
  OpsStatusBadge,
  OpsTone,
} from './shared'

const statusTone: Record<TransactionStatus, OpsTone> = {
  AWAITING_PAYMENT: 'warning',
  PAYMENT_COMPLETED: 'success',
  PAYMENT_EXPIRED: 'neutral',
  PAYMENT_FAILED: 'danger',
  PROCESSING_PAYMENT: 'info',
  WRONG_AMOUNT: 'danger',
}

const TransactionsList = () => {
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
      keyRequiredMessage="Ops API key required to load transactions."
      subtitle="Look up transactions by status, partner, user, on-chain hash, or external id."
      title="Transactions"
    >
      <div className="ops-card mt-8 grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
        <OpsField label="Status">
          <select
            className="ops-input"
            onChange={event => setStatus(event.target.value as '' | TransactionStatus)}
            value={status}
          >
            <option value="">All</option>
            {transactionStatuses.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </OpsField>
        <OpsField label="Partner ID">
          <input
            className="ops-input"
            onChange={event => setPartnerId(event.target.value)}
            placeholder="partner UUID"
            value={partnerId}
          />
        </OpsField>
        <OpsField label="User ID">
          <input
            className="ops-input"
            onChange={event => setUserId(event.target.value)}
            placeholder="partner user id"
            value={userId}
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
        <OpsField label="External ID">
          <input
            className="ops-input"
            onChange={event => setExternalId(event.target.value)}
            placeholder="provider external id"
            value={externalId}
          />
        </OpsField>
        <div className="flex items-end">
          <button
            className="ops-btn-primary w-full"
            onClick={() => setPage(1)}
            type="button"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-xs text-ops-muted">
          {data ? `${data.total} result${data.total === 1 ? '' : 's'}` : ''}
        </div>
        <OpsPagination
          loading={loading}
          onChange={setPage}
          page={page}
          totalPages={totalPages}
        />
      </div>

      <div className="mt-4 space-y-3">
        {loading && opsApiKey && (
          <OpsLoading label="Loading transactions…" />
        )}

        {!loading && opsApiKey && data?.items.length === 0 && (
          <OpsEmptyState>No transactions match the current filters.</OpsEmptyState>
        )}

        {data?.items.map(transaction => (
          <Link
            className="ops-card-interactive block px-6 py-4 text-left"
            key={transaction.id}
            to={`/ops/transactions/${transaction.id}`}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <OpsStatusBadge label={transaction.status} tone={statusTone[transaction.status]} />
                  <span className="text-xs uppercase tracking-wider text-ops-muted">
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
                <div className="mt-1 text-xs text-ops-muted">
                  Created
                  {' '}
                  {formatDateTime(transaction.createdAt)}
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
                  <div className="mt-1 text-xs text-ops-muted break-all">
                    On-chain
                    {' '}
                    {transaction.onChainId}
                  </div>
                )}
              </div>
              <div className="text-right text-sm text-ops-text">
                <div className="font-semibold">
                  {formatAmount(transaction.quote.targetAmount)}
                  {' '}
                  {transaction.quote.targetCurrency}
                </div>
                <div className="text-xs text-ops-muted">
                  {formatAmount(transaction.quote.sourceAmount)}
                  {' '}
                  {transaction.quote.cryptoCurrency}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </OpsPageShell>
  )
}

export default TransactionsList
