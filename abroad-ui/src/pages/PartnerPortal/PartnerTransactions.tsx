import { useTranslate } from '@tolgee/react'
import {
  ArrowUpRight,
  Cable,
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  Download,
  FilterX,
  LoaderCircle,
  RefreshCw,
  Search,
} from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type {
  PartnerTransactionFilters,
  PartnerTransactionListResponse,
  PartnerTransactionStatus,
  PartnerTransactionSummary,
} from '../../services/partnerPortal/partnerPortalTypes'

import { exportPartnerTransactions, listPartnerTransactions } from '../../services/partnerPortal/partnerPortalApi'
import { usePartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'
import { partnerTransactionStatuses } from '../../services/partnerPortal/partnerPortalTypes'
import {
  formatPartnerAmount,
  formatPartnerDateTime,
  partnerStatusMeta,
  shortTransactionId,
  spectrumWeightClass,
} from './partnerPortalPresentation'
import { PartnerStatusBadge } from './partnerPortalUi'

const PAGE_SIZE = 20

type AppliedFilters = Pick<PartnerTransactionFilters, 'createdFrom' | 'createdTo' | 'query'>

const emptyFilters: AppliedFilters = {}

const StatusSpectrum = ({ activeStatus, data, onChange }: {
  activeStatus?: PartnerTransactionStatus
  data: null | PartnerTransactionListResponse
  onChange: (status?: PartnerTransactionStatus) => void
}) => {
  const countFor = (status: PartnerTransactionStatus): number => (
    data?.statusCounts.find(item => item.status === status)?.count ?? 0
  )
  const allCount = data?.statusCounts.reduce((sum, item) => sum + item.count, 0) ?? 0
  const maximumCount = Math.max(...partnerTransactionStatuses.map(countFor), 1)

  return (
    <section aria-labelledby="status-spectrum-title" className="partner-spectrum">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="partner-eyebrow">Live ledger</p>
          <h2 className="mt-1 text-base font-semibold text-partner-ink" id="status-spectrum-title">Status spectrum</h2>
        </div>
        <p className="text-xs text-partner-muted">Select a status to filter the ledger</p>
      </div>

      <div aria-hidden className="mt-5 flex h-2 overflow-hidden rounded-full bg-partner-border/70">
        {partnerTransactionStatuses.map((status) => {
          const count = countFor(status)
          return (
            <span
              className={`${partnerStatusMeta[status].spectrumClass} ${spectrumWeightClass(count, maximumCount)} min-w-0 transition-[flex-grow] duration-300 motion-reduce:transition-none`}
              key={status}
              title={`${partnerStatusMeta[status].label}: ${count}`}
            />
          )
        })}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <button
          aria-pressed={!activeStatus}
          className={`partner-spectrum-button ${activeStatus ? '' : 'partner-spectrum-button-active'}`}
          onClick={() => onChange(undefined)}
          type="button"
        >
          <span>All</span>
          <strong>{allCount}</strong>
        </button>
        {partnerTransactionStatuses.map(status => (
          <button
            aria-pressed={activeStatus === status}
            className={`partner-spectrum-button ${activeStatus === status ? 'partner-spectrum-button-active' : ''}`}
            key={status}
            onClick={() => onChange(activeStatus === status ? undefined : status)}
            type="button"
          >
            <span className="truncate">{partnerStatusMeta[status].label}</span>
            <strong>{countFor(status)}</strong>
          </button>
        ))}
      </div>
    </section>
  )
}

const MobileTransaction = ({ transaction }: { transaction: PartnerTransactionSummary }) => (
  <Link className="partner-mobile-transaction" to={`/partner/transactions/${transaction.id}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold text-partner-ink">{shortTransactionId(transaction.id)}</p>
        <p className="mt-1 truncate text-xs text-partner-muted">{transaction.userReference}</p>
      </div>
      <PartnerStatusBadge status={transaction.status} />
    </div>
    <div className="mt-5 grid grid-cols-2 gap-4 border-t border-partner-border pt-4">
      <div>
        <p className="partner-label">Payout</p>
        <p className="mt-1 text-sm font-semibold text-partner-ink">
          {formatPartnerAmount(transaction.quote.targetAmount, transaction.quote.targetCurrency)}
        </p>
      </div>
      <div className="text-right">
        <p className="partner-label">Received</p>
        <p className="mt-1 text-sm text-partner-ink">
          {formatPartnerAmount(transaction.quote.sourceAmount, transaction.quote.cryptoCurrency)}
        </p>
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-partner-muted">
      <span>{formatPartnerDateTime(transaction.createdAt)}</span>
      <ArrowUpRight aria-hidden className="h-4 w-4 shrink-0 text-partner-forest" />
    </div>
  </Link>
)

const PartnerTransactions = () => {
  const { t } = useTranslate()
  const session = usePartnerPortalSession()
  const [activeStatus, setActiveStatus] = useState<PartnerTransactionStatus | undefined>()
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(emptyFilters)
  const [data, setData] = useState<null | PartnerTransactionListResponse>(null)
  const [draftCreatedFrom, setDraftCreatedFrom] = useState('')
  const [draftCreatedTo, setDraftCreatedTo] = useState('')
  const [draftQuery, setDraftQuery] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [exporting, setExporting] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    void listPartnerTransactions({
      ...appliedFilters,
      page,
      pageSize: PAGE_SIZE,
      status: activeStatus,
    }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setData(response)
        setLastUpdated(new Date())
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load transactions')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [
    activeStatus,
    appliedFilters,
    page,
    refreshKey,
  ])

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(1)
    setAppliedFilters({
      createdFrom: draftCreatedFrom || undefined,
      createdTo: draftCreatedTo || undefined,
      query: draftQuery.trim() || undefined,
    })
  }

  const clearFilters = () => {
    setActiveStatus(undefined)
    setAppliedFilters(emptyFilters)
    setDraftCreatedFrom('')
    setDraftCreatedTo('')
    setDraftQuery('')
    setPage(1)
  }

  const downloadExport = async () => {
    if (exporting) return
    setExporting(true)
    setError(null)
    try {
      const csv = await exportPartnerTransactions({ ...appliedFilters, status: activeStatus })
      const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `abroad-transactions-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export transactions')
    }
    finally {
      setExporting(false)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const hasFilters = Boolean(activeStatus || appliedFilters.createdFrom || appliedFilters.createdTo || appliedFilters.query)

  return (
    <>
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="partner-eyebrow">Partner workspace</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-partner-ink sm:text-5xl">Transactions</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-partner-muted sm:text-base">
            Follow every payout from funds received through final delivery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session?.role === 'ADMIN' && session.mfaVerified && (
            <Link className="partner-button-secondary" to="/partner/reconciliation">
              <DatabaseZap aria-hidden className="h-4 w-4" />
              PIX reconciliation
            </Link>
          )}
          <button
            className="partner-button-secondary"
            disabled={loading}
            onClick={() => setRefreshKey(key => key + 1)}
            type="button"
          >
            <RefreshCw aria-hidden className={`h-4 w-4 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            Refresh
          </button>
          <button
            className="partner-button-primary"
            disabled={exporting}
            onClick={() => void downloadExport()}
            type="button"
          >
            {exporting
              ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              : <Download aria-hidden className="h-4 w-4" />}
            {exporting ? 'Preparing…' : 'Export CSV'}
          </button>
        </div>
      </header>

      <div className="mt-10">
        <StatusSpectrum
          activeStatus={activeStatus}
          data={data}
          onChange={(status) => {
            setActiveStatus(status)
            setPage(1)
          }}
        />
      </div>

      <form className="partner-filter-bar mt-6" onSubmit={applyFilters}>
        <div className="min-w-0 flex-1 sm:min-w-64">
          <label className="partner-label" htmlFor="transaction-search">Search</label>
          <div className="relative mt-2">
            <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-partner-muted" />
            <input
              className="partner-input w-full pl-10"
              id="transaction-search"
              onChange={event => setDraftQuery(event.target.value)}
              placeholder="Transaction, user, or on-chain ID"
              value={draftQuery}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div>
            <label className="partner-label" htmlFor="created-from">From</label>
            <input
              className="partner-input mt-2 w-full sm:w-40"
              id="created-from"
              onChange={event => setDraftCreatedFrom(event.target.value)}
              type="date"
              value={draftCreatedFrom}
            />
          </div>
          <div>
            <label className="partner-label" htmlFor="created-to">To</label>
            <input
              className="partner-input mt-2 w-full sm:w-40"
              id="created-to"
              onChange={event => setDraftCreatedTo(event.target.value)}
              type="date"
              value={draftCreatedTo}
            />
          </div>
        </div>
        <div className="flex items-end gap-2">
          {hasFilters && (
            <button className="partner-icon-button h-11 w-11" onClick={clearFilters} title="Clear filters" type="button">
              <FilterX aria-hidden className="h-4 w-4" />
              <span className="sr-only">Clear filters</span>
            </button>
          )}
          <button className="partner-button-primary h-11" type="submit">Apply filters</button>
        </div>
      </form>

      {error && (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button className="font-semibold underline underline-offset-4" onClick={() => setRefreshKey(key => key + 1)} type="button">
              Try again
            </button>
          </div>
        </div>
      )}

      <section aria-busy={loading} aria-labelledby="transaction-ledger-title" className="mt-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-partner-ink" id="transaction-ledger-title">Transaction ledger</h2>
            <p aria-live="polite" className="mt-1 text-xs text-partner-muted">
              {data ? `${data.total} transaction${data.total === 1 ? '' : 's'}` : 'Loading transactions'}
              {lastUpdated ? ` · Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </p>
          </div>
          {data && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                aria-label="Previous page"
                className="partner-icon-button h-10 w-10"
                disabled={page <= 1 || loading}
                onClick={() => setPage(current => Math.max(1, current - 1))}
                type="button"
              >
                <ChevronLeft aria-hidden className="h-4 w-4" />
              </button>
              <span className="min-w-24 text-center text-xs font-medium tabular-nums text-partner-muted">
                Page
                {' '}
                {page}
                {' '}
                of
                {' '}
                {totalPages}
              </span>
              <button
                aria-label="Next page"
                className="partner-icon-button h-10 w-10"
                disabled={page >= totalPages || loading}
                onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                type="button"
              >
                <ChevronRight aria-hidden className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {loading && !data && (
          <div aria-live="polite" className="partner-empty-state mt-4">
            <LoaderCircle aria-hidden className="h-5 w-5 animate-spin text-partner-forest motion-reduce:animate-none" />
            <span>Loading your transactions…</span>
          </div>
        )}

        {!loading && data?.items.length === 0 && (
          <div className="partner-empty-state mt-4">
            <Search aria-hidden className="h-5 w-5 text-partner-forest" />
            <div>
              <p className="font-semibold text-partner-ink">No matching transactions</p>
              <p className="mt-1 text-sm text-partner-muted">Adjust the status, dates, or search reference.</p>
              {!hasFilters && data.total === 0 && (
                <Link className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-partner-forest underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest" to="/partner/integration/ai?from=transaction-empty">
                  <Cable aria-hidden className="h-4 w-4" />
                  {t('partner.ai.empty_state_link', 'Connect your AI client')}
                </Link>
              )}
            </div>
          </div>
        )}

        {data && data.items.length > 0 && (
          <>
            <div className={`partner-table-shell mt-4 hidden md:block ${loading ? 'opacity-60' : ''}`}>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Created</th>
                    <th>Route</th>
                    <th className="text-right">Received</th>
                    <th className="text-right">Payout</th>
                    <th>Status</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(transaction => (
                    <tr key={transaction.id}>
                      <td>
                        <Link className="group inline-flex max-w-48 flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-forest" to={`/partner/transactions/${transaction.id}`}>
                          <span className="font-mono text-sm font-semibold text-partner-ink group-hover:text-partner-forest">
                            {shortTransactionId(transaction.id)}
                          </span>
                          <span className="mt-1 truncate text-xs text-partner-muted" title={transaction.userReference}>
                            {transaction.userReference}
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-sm text-partner-muted">{formatPartnerDateTime(transaction.createdAt)}</td>
                      <td>
                        <span className="text-sm font-medium text-partner-ink">{transaction.quote.network}</span>
                        <span className="mt-1 block text-xs text-partner-muted">{transaction.quote.paymentMethod}</span>
                      </td>
                      <td className="whitespace-nowrap text-right text-sm text-partner-muted">
                        {formatPartnerAmount(transaction.quote.sourceAmount, transaction.quote.cryptoCurrency)}
                      </td>
                      <td className="whitespace-nowrap text-right text-sm font-semibold text-partner-ink">
                        {formatPartnerAmount(transaction.quote.targetAmount, transaction.quote.targetCurrency)}
                      </td>
                      <td><PartnerStatusBadge status={transaction.status} /></td>
                      <td className="text-right">
                        <Link aria-label={`Open transaction ${shortTransactionId(transaction.id)}`} className="partner-icon-button" to={`/partner/transactions/${transaction.id}`}>
                          <ArrowUpRight aria-hidden className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`mt-4 space-y-3 md:hidden ${loading ? 'opacity-60' : ''}`}>
              {data.items.map(transaction => <MobileTransaction key={transaction.id} transaction={transaction} />)}
            </div>
          </>
        )}
      </section>
    </>
  )
}

export default PartnerTransactions
