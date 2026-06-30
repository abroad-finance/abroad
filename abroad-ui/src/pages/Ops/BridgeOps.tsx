import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { getBridgeOverview } from '../../services/admin/bridgeAdminApi'
import {
  OpsBridgeBatchStatus,
  OpsBridgeLegStatus,
  OpsBridgeOverview,
} from '../../services/admin/bridgeTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const batchStatusClasses: Record<OpsBridgeBatchStatus, string> = {
  CREDITED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  OPEN: 'bg-slate-100 text-slate-700 border-slate-200',
  SUBMITTED: 'bg-sky-100 text-sky-800 border-sky-200',
}

const legStatusClasses: Record<OpsBridgeLegStatus, string> = {
  BATCHED: 'bg-sky-100 text-sky-800 border-sky-200',
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  SETTLED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}

const legStatusOrder: OpsBridgeLegStatus[] = [
  'PENDING',
  'BATCHED',
  'SETTLED',
  'FAILED',
]

const formatDate = (value: null | string) => (value ? new Date(value).toLocaleString() : '—')

const formatAmount = (value: null | number) => (value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 6 }))

const BridgeOps = () => {
  const [data, setData] = useState<null | OpsBridgeOverview>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()

  const load = useCallback(async () => {
    if (!opsApiKey) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    try {
      const result = await getBridgeOverview()
      setData(result)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bridge overview')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey])

  useEffect(() => {
    void load()
  }, [load])

  const float = data?.float
  const utilization = float && float.cap && float.cap > 0
    ? Math.min(100, Math.round((float.deficit / float.cap) * 100))
    : null

  const legByStatus = (status: OpsBridgeLegStatus) =>
    data?.legs.byStatus.find(group => group.status === status)

  return (
    <div className="ops-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-3 text-sm">
                <Link className="text-ops-brand hover:text-abroad-dark" to="/ops/flows">← Back to flows</Link>
                <Link className="text-ops-brand hover:text-abroad-dark" to="/ops/transactions">Transactions</Link>
              </div>
              <div className="mt-3 text-sm uppercase tracking-[0.3em] text-abroad-dark">Treasury</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Bridge Float &amp; Settlement</h1>
              <p className="text-sm text-gray-600 max-w-xl mt-2">
                Outstanding USDC fronted by the Transfero float, pending bridge legs, and the batched
                Binance settlement board.
              </p>
            </div>
            <button
              className="ops-btn-ghost"
              disabled={!opsApiKey || loading}
              onClick={() => void load()}
              type="button"
            >
              Refresh
            </button>
          </div>

          <OpsApiKeyPanel />

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          {!opsApiKey && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to load the bridge overview.
            </div>
          )}
          {loading && opsApiKey && (
            <div className="mt-6 text-sm text-gray-500">Loading bridge overview...</div>
          )}

          {data && opsApiKey && (
            <>
              <div className="mt-8 rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Float</h2>
                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${float?.enabled ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {float?.enabled ? 'Guard enabled' : 'Guard disabled'}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray-500">Outstanding deficit</div>
                    <div className="mt-1 text-2xl font-semibold">{formatAmount(float?.deficit ?? 0)}</div>
                    <div className="text-xs text-gray-500">USDC fronted, not yet bridged</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray-500">Cap</div>
                    <div className="mt-1 text-2xl font-semibold">{formatAmount(float?.cap ?? null)}</div>
                    <div className="text-xs text-gray-500">BRIDGE_FLOAT_CAP_USDC</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray-500">Available</div>
                    <div className="mt-1 text-2xl font-semibold">{formatAmount(float?.available ?? null)}</div>
                    <div className="text-xs text-gray-500">Capacity for new flows</div>
                  </div>
                </div>
                {utilization !== null && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Utilization</span>
                      <span>
                        {utilization}
                        %
                      </span>
                    </div>
                    <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${utilization >= 90 ? 'bg-rose-500' : utilization >= 70 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                        style={{ width: `${utilization}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Pending legs</h2>
                  <div className="text-xs text-gray-500">
                    Oldest pending:
                    {' '}
                    {formatDate(data.legs.oldestPendingAt)}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  {legStatusOrder.map((status) => {
                    const group = legByStatus(status)
                    return (
                      <div
                        className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_15px_45px_-35px_rgba(15,23,42,0.45)]"
                        key={status}
                      >
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${legStatusClasses[status]}`}>
                          {status}
                        </span>
                        <div className="mt-3 text-2xl font-semibold">{group?.count ?? 0}</div>
                        <div className="text-xs text-gray-500">
                          {formatAmount(group?.amount ?? 0)}
                          {' '}
                          USDC
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="mt-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Batch board</h2>
                  <div className="text-xs text-gray-500">
                    {data.batches.length}
                    {' '}
                    recent
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {data.batches.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/70 px-6 py-10 text-center text-sm text-gray-500">
                      No bridge batches yet.
                    </div>
                  )}
                  {data.batches.map(batch => (
                    <div
                      className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_15px_45px_-35px_rgba(15,23,42,0.45)]"
                      key={batch.id}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${batchStatusClasses[batch.status]}`}>
                              {batch.status}
                            </span>
                            <span className="text-sm font-semibold">
                              {batch.asset}
                              {' → '}
                              {batch.destNetwork}
                            </span>
                            <span className="text-xs text-gray-500">
                              {batch.memberCount}
                              {' '}
                              legs
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-gray-500 break-all">
                            {batch.id}
                          </div>
                          {batch.withdrawId && (
                            <div className="text-xs text-gray-500 break-all">
                              Withdraw:
                              {' '}
                              {batch.withdrawId}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-xs text-gray-500">
                          <div className="text-sm font-semibold text-gray-800">
                            {formatAmount(batch.grossAmount)}
                            {' '}
                            {batch.asset}
                          </div>
                          {batch.withdrawFee !== null && (
                            <div>
                              Fee:
                              {' '}
                              {formatAmount(batch.withdrawFee)}
                            </div>
                          )}
                          <div className="mt-1">
                            Created
                            {' '}
                            {formatDate(batch.createdAt)}
                          </div>
                          <div>
                            Settled
                            {' '}
                            {formatDate(batch.settledAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default BridgeOps
