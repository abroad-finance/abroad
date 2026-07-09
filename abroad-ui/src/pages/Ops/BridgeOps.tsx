import { useCallback, useEffect, useState } from 'react'

import { getBridgeOverview } from '../../services/admin/bridgeAdminApi'
import {
  OpsBridgeBatchStatus,
  OpsBridgeLegStatus,
  OpsBridgeOverview,
} from '../../services/admin/bridgeTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatAmount,
  formatDateTime,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
  UtilizationMeter,
} from './shared'

const batchStatusTone: Record<OpsBridgeBatchStatus, OpsTone> = {
  CREDITED: 'success',
  FAILED: 'danger',
  OPEN: 'neutral',
  SUBMITTED: 'info',
}

const legStatusTone: Record<OpsBridgeLegStatus, OpsTone> = {
  BATCHED: 'info',
  FAILED: 'danger',
  PENDING: 'warning',
  SETTLED: 'success',
}

const legStatusOrder: OpsBridgeLegStatus[] = [
  'PENDING',
  'BATCHED',
  'SETTLED',
  'FAILED',
]

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

  const legByStatus = (status: OpsBridgeLegStatus) =>
    data?.legs.byStatus.find(group => group.status === status)

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey || loading}
          onClick={() => void load()}
          type="button"
        >
          Refresh
        </button>
      )}
      backLink={{ label: 'Back to flows', to: '/ops/flows' }}
      error={error}
      eyebrow="Treasury"
      keyRequiredMessage="Ops API key required to load the bridge overview."
      subtitle="Outstanding USDC fronted by the Transfero float, pending bridge legs, and the batched Binance settlement board."
      title="Bridge Float & Settlement"
    >
      {loading && opsApiKey && (
        <OpsLoading label="Loading bridge overview…" />
      )}

      {data && opsApiKey && (
        <>
          <div className="ops-card mt-8 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Float</h2>
              <OpsStatusBadge tone={float?.enabled ? 'success' : 'neutral'}>
                {float?.enabled ? 'Guard enabled' : 'Guard disabled'}
              </OpsStatusBadge>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-ops-muted">Outstanding deficit</div>
                <div className="mt-1 text-2xl font-semibold">{formatAmount(float?.deficit ?? 0)}</div>
                <div className="text-xs text-ops-muted">USDC fronted, not yet bridged</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-ops-muted">Cap</div>
                <div className="mt-1 text-2xl font-semibold">{formatAmount(float?.cap ?? null)}</div>
                <div className="text-xs text-ops-muted">BRIDGE_FLOAT_CAP_USDC</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-ops-muted">Available</div>
                <div className="mt-1 text-2xl font-semibold">{formatAmount(float?.available ?? null)}</div>
                <div className="text-xs text-ops-muted">Capacity for new flows</div>
              </div>
            </div>
            <UtilizationMeter cap={float?.cap} className="mt-5" deficit={float?.deficit} />
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pending legs</h2>
              <div className="text-xs text-ops-muted">
                Oldest pending:
                {' '}
                {formatDateTime(data.legs.oldestPendingAt)}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              {legStatusOrder.map((status) => {
                const group = legByStatus(status)
                return (
                  <div className="ops-card p-4" key={status}>
                    <OpsStatusBadge label={status} tone={legStatusTone[status]} />
                    <div className="mt-3 text-2xl font-semibold">{group?.count ?? 0}</div>
                    <div className="text-xs text-ops-muted">
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
              <div className="text-xs text-ops-muted">
                {data.batches.length}
                {' '}
                recent
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {data.batches.length === 0 && (
                <OpsEmptyState>No bridge batches yet.</OpsEmptyState>
              )}
              {data.batches.map(batch => (
                <div className="ops-card p-4" key={batch.id}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <OpsStatusBadge label={batch.status} tone={batchStatusTone[batch.status]} />
                        <span className="text-sm font-semibold">
                          {batch.asset}
                          {' → '}
                          {batch.destNetwork}
                        </span>
                        <span className="text-xs text-ops-muted">
                          {batch.memberCount}
                          {' '}
                          legs
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-ops-muted break-all">
                        {batch.id}
                      </div>
                      {batch.withdrawId && (
                        <div className="text-xs text-ops-muted break-all">
                          Withdraw:
                          {' '}
                          {batch.withdrawId}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs text-ops-muted">
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
                        {formatDateTime(batch.createdAt)}
                      </div>
                      <div>
                        Settled
                        {' '}
                        {formatDateTime(batch.settledAt)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </OpsPageShell>
  )
}

export default BridgeOps
