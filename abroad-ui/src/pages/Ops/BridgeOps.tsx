import {
  ChevronDown, ChevronUp, ExternalLink, FilterX,
} from 'lucide-react'
import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type {
  OpsBridgeBatchStatus,
  OpsBridgeLegStatus,
  OpsBridgeOverview,
  OpsBridgeReconciliationState,
  OpsBridgeSlaState,
} from '../../services/admin/bridgeTypes'

import { getBridgeOverview } from '../../services/admin/bridgeAdminApi'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatAmount,
  formatDateTime,
  humanizeStatus,
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

const slaTone: Record<OpsBridgeSlaState, OpsTone> = {
  BREACHED: 'danger',
  MET: 'success',
  ON_TRACK: 'info',
}

const reconciliationTone: Record<OpsBridgeReconciliationState, OpsTone> = {
  ACTION_REQUIRED: 'danger',
  AWAITING_PROVIDER: 'warning',
  COLLECTING: 'info',
  RECONCILED: 'success',
}

const reconciliationLabel: Record<OpsBridgeReconciliationState, string> = {
  ACTION_REQUIRED: 'Action required',
  AWAITING_PROVIDER: 'Awaiting provider',
  COLLECTING: 'Collecting legs',
  RECONCILED: 'Reconciled',
}

const slaLabel: Record<OpsBridgeSlaState, string> = {
  BREACHED: 'SLA breached',
  MET: 'SLA met',
  ON_TRACK: 'On track',
}

const legStatusOrder: OpsBridgeLegStatus[] = [
  'PENDING',
  'BATCHED',
  'SETTLED',
  'FAILED',
]

const COLLAPSED_BATCH_COUNT = 8
const COLLAPSED_LEG_COUNT = 12

const BridgeOps = () => {
  const [data, setData] = useState<null | OpsBridgeOverview>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [showAllBatches, setShowAllBatches] = useState(false)
  const [showAllLegs, setShowAllLegs] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
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
      setData(await getBridgeOverview())
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load bridge overview')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey])

  useEffect(() => {
    void load()
  }, [load])

  const float = data?.float
  const networkFilter = searchParams.get('network')?.trim() ?? ''
  const statusFilter = searchParams.get('status')?.trim() ?? ''
  const legIdFilter = searchParams.get('legId')?.trim() ?? ''
  const hasFilters = Boolean(networkFilter || statusFilter || legIdFilter)

  const filteredBatches = useMemo(() => (data?.batches ?? []).filter(batch => (
    (!networkFilter || batch.destNetwork === networkFilter)
    && (!statusFilter || batch.status === statusFilter)
    && !legIdFilter
  )), [
    data?.batches,
    legIdFilter,
    networkFilter,
    statusFilter,
  ])

  const filteredLegs = useMemo(() => (data?.legs.recent ?? []).filter(leg => (
    (!networkFilter || leg.destNetwork === networkFilter)
    && (!statusFilter || leg.status === statusFilter)
    && (!legIdFilter || leg.id === legIdFilter)
  )), [
    data?.legs.recent,
    legIdFilter,
    networkFilter,
    statusFilter,
  ])

  const displayedBatches = showAllBatches
    ? filteredBatches
    : filteredBatches.slice(0, COLLAPSED_BATCH_COUNT)
  const displayedLegs = showAllLegs
    ? filteredLegs
    : filteredLegs.slice(0, COLLAPSED_LEG_COUNT)

  const legByStatus = (status: OpsBridgeLegStatus) => (
    data?.legs.byStatus.find(group => group.status === status)
  )

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
      backLink={{ label: 'Back to treasury', to: '/ops/treasury' }}
      error={error}
      eyebrow="Money · Treasury"
      keyRequiredMessage="Sign in to load the bridge settlement overview."
      subtitle="Track float consumed by customer payouts and the settlement legs that replenish it."
      title="Bridge settlement"
    >
      {loading && opsApiKey && !data && (
        <OpsLoading label="Loading bridge settlement…" />
      )}

      {data && opsApiKey && (
        <>
          {hasFilters && (
            <div className="mt-6 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
              <span className="font-semibold">Filtered investigation</span>
              {networkFilter && (
                <span className="rounded-full bg-white px-2 py-1">
                  Network:
                  {networkFilter}
                </span>
              )}
              {statusFilter && (
                <span className="rounded-full bg-white px-2 py-1">
                  State:
                  {statusFilter}
                </span>
              )}
              {legIdFilter && <span className="rounded-full bg-white px-2 py-1">Specific bridge leg</span>}
              <button
                className="ops-btn-ghost ops-btn-sm ml-auto"
                onClick={() => setSearchParams({})}
                type="button"
              >
                <FilterX aria-hidden className="h-4 w-4" />
                Clear filters
              </button>
            </div>
          )}

          <section aria-labelledby="bridge-float-heading" className="ops-card mt-8 p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="ops-label">Settlement capacity</div>
                <h2 className="mt-1 text-lg font-semibold" id="bridge-float-heading">Customer payout float</h2>
              </div>
              <OpsStatusBadge tone={float?.enabled ? 'success' : 'neutral'}>
                {float?.enabled ? 'Limit active' : 'Limit not configured'}
              </OpsStatusBadge>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-ops-border bg-stone-50 p-4">
                <div className="text-xs uppercase tracking-wider text-ops-muted">Consumed</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{formatAmount(float?.deficit ?? 0)}</div>
                <div className="text-xs text-ops-muted">USDC already fronted for payouts</div>
              </div>
              <div className="rounded-2xl border border-ops-border bg-stone-50 p-4">
                <div className="text-xs uppercase tracking-wider text-ops-muted">Operating limit</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{formatAmount(float?.cap ?? null)}</div>
                <div className="text-xs text-ops-muted">Maximum approved USDC exposure</div>
              </div>
              <div className="rounded-2xl border border-ops-border bg-stone-50 p-4">
                <div className="text-xs uppercase tracking-wider text-ops-muted">Available</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{formatAmount(float?.available ?? null)}</div>
                <div className="text-xs text-ops-muted">Capacity for new customer payouts</div>
              </div>
            </div>
            <UtilizationMeter cap={float?.cap} className="mt-5" deficit={float?.deficit} />
            {Boolean((float?.deficit ?? 0) > 0 && !data.legs.oldestPendingAt) && (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
                Consumed float can remain while legs are already batched and awaiting provider settlement. “Oldest pending” measures only unbatched pending legs, so it can be empty while exposure remains.
              </div>
            )}
          </section>

          <section aria-labelledby="bridge-legs-heading" className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="ops-label">Settlement pipeline</div>
                <h2 className="mt-1 text-lg font-semibold" id="bridge-legs-heading">Leg state</h2>
              </div>
              <div className="text-xs text-ops-muted">
                Oldest unbatched leg:
                {' '}
                {formatDateTime(data.legs.oldestPendingAt)}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {legStatusOrder.map((status) => {
                const group = legByStatus(status)
                return (
                  <div className="ops-card p-4" key={status}>
                    <OpsStatusBadge label={status} tone={legStatusTone[status]} />
                    <div className="mt-3 text-2xl font-semibold tabular-nums">{group?.count ?? 0}</div>
                    <div className="text-xs text-ops-muted">
                      {formatAmount(group?.amount ?? 0)}
                      {' USDC'}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section aria-labelledby="recent-legs-heading" className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="ops-label">Transaction evidence</div>
                <h2 className="mt-1 text-lg font-semibold" id="recent-legs-heading">Recent settlement legs</h2>
              </div>
              <span className="text-xs text-ops-muted">
                {filteredLegs.length}
                {' '}
                matching
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {filteredLegs.length === 0 && (
                <OpsEmptyState>
                  {hasFilters ? 'No recent legs match this investigation. Clear the filters to see all recent settlement work.' : 'No bridge legs yet.'}
                </OpsEmptyState>
              )}
              {displayedLegs.map(leg => (
                <article className="ops-card p-4" id={`leg-${leg.id}`} key={leg.id}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <OpsStatusBadge label={humanizeStatus(leg.status)} tone={legStatusTone[leg.status]} />
                        <OpsStatusBadge label={slaLabel[leg.slaState]} tone={slaTone[leg.slaState]} />
                        <OpsStatusBadge
                          label={reconciliationLabel[leg.reconciliationState]}
                          tone={reconciliationTone[leg.reconciliationState]}
                        />
                      </div>
                      <div className="mt-3 text-sm font-semibold">
                        {formatAmount(leg.amount)}
                        {' '}
                        {leg.asset}
                        {' → '}
                        {leg.destNetwork}
                      </div>
                      {leg.transaction && (
                        <div className="mt-1 text-xs text-ops-muted">
                          {leg.transaction.partner.name}
                          {' · '}
                          {humanizeStatus(leg.transaction.status)}
                        </div>
                      )}
                      <div className="mt-2 font-mono text-[11px] text-ops-muted break-all">
                        Leg
                        {leg.id}
                      </div>
                    </div>
                    <div className="min-w-0 text-xs text-ops-muted md:text-right">
                      <div>
                        Expected by
                        {formatDateTime(leg.expectedSlaAt)}
                      </div>
                      <div>
                        Updated
                        {formatDateTime(leg.updatedAt)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
                        {leg.transaction && (
                          <Link className="ops-btn-ghost ops-btn-sm" to={`/ops/transactions/${encodeURIComponent(leg.transaction.id)}`}>
                            Transaction
                          </Link>
                        )}
                        <Link className="ops-btn-ghost ops-btn-sm" to={leg.incidentPath}>
                          Incidents
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {filteredLegs.length > COLLAPSED_LEG_COUNT && (
              <button
                className="ops-btn-ghost mt-4 w-full"
                onClick={() => setShowAllLegs(value => !value)}
                type="button"
              >
                {showAllLegs ? <ChevronUp aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
                {showAllLegs ? 'Show fewer legs' : `Show all ${filteredLegs.length} legs`}
              </button>
            )}
          </section>

          <section aria-labelledby="batch-board-heading" className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="ops-label">Provider settlement</div>
                <h2 className="mt-1 text-lg font-semibold" id="batch-board-heading">Batch board</h2>
              </div>
              <span className="text-xs text-ops-muted">
                {filteredBatches.length}
                {' '}
                matching
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {filteredBatches.length === 0 && (
                <OpsEmptyState>
                  {hasFilters ? 'No recent batches match this investigation.' : 'No bridge batches yet.'}
                </OpsEmptyState>
              )}
              {displayedBatches.map(batch => (
                <article className="ops-card p-4" key={batch.id}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <OpsStatusBadge label={humanizeStatus(batch.status)} tone={batchStatusTone[batch.status]} />
                        <OpsStatusBadge label={slaLabel[batch.slaState]} tone={slaTone[batch.slaState]} />
                        <OpsStatusBadge
                          label={reconciliationLabel[batch.reconciliationState]}
                          tone={reconciliationTone[batch.reconciliationState]}
                        />
                      </div>
                      <div className="mt-3 text-sm font-semibold">
                        {formatAmount(batch.grossAmount)}
                        {' '}
                        {batch.asset}
                        {' → '}
                        {batch.destNetwork}
                      </div>
                      <div className="mt-1 text-xs text-ops-muted">
                        {batch.memberCount}
                        {' settlement leg'}
                        {batch.memberCount === 1 ? '' : 's'}
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-ops-muted break-all">
                        Batch
                        {batch.id}
                      </div>
                    </div>
                    <div className="min-w-0 text-xs text-ops-muted md:text-right">
                      <div>
                        Expected by
                        {formatDateTime(batch.expectedSlaAt)}
                      </div>
                      <div>
                        Created
                        {formatDateTime(batch.createdAt)}
                      </div>
                      <div>
                        Settled
                        {formatDateTime(batch.settledAt)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
                        <Link className="ops-btn-ghost ops-btn-sm" to={batch.incidentPath}>Incidents</Link>
                        <Link className="ops-btn-ghost ops-btn-sm" to={batch.runbookPath}>
                          Runbook
                          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                        </Link>
                        <Link
                          className="ops-btn-primary ops-btn-sm"
                          to={`/ops/treasury/bridge/batches/${encodeURIComponent(batch.id)}`}
                        >
                          Open batch
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {filteredBatches.length > COLLAPSED_BATCH_COUNT && (
              <button
                className="ops-btn-ghost mt-4 w-full"
                onClick={() => setShowAllBatches(value => !value)}
                type="button"
              >
                {showAllBatches ? <ChevronUp aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
                {showAllBatches ? 'Show fewer batches' : `Show all ${filteredBatches.length} batches`}
              </button>
            )}
          </section>
        </>
      )}
    </OpsPageShell>
  )
}

export default BridgeOps
