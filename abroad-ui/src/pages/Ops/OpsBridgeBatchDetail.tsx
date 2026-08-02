import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import type {
  OpsBridgeBatchDetail,
  OpsBridgeLegStatus,
  OpsBridgeReconciliationState,
  OpsBridgeSlaState,
} from '../../services/admin/bridgeTypes'

import { getBridgeBatchDetail } from '../../services/admin/bridgeAdminApi'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  formatAmount,
  formatDateTime,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'

const legTone: Record<OpsBridgeLegStatus, OpsTone> = {
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

const humanize = (value: string): string => value.replace(/_/g, ' ').toLowerCase()

const OpsBridgeBatchDetailPage = () => {
  const { batchId = '' } = useParams<{ batchId: string }>()
  const opsApiKey = useOpsApiKey()
  const [detail, setDetail] = useState<null | OpsBridgeBatchDetail>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!opsApiKey || !batchId) {
      setDetail(null)
      return
    }
    setError(null)
    setLoading(true)
    try {
      setDetail(await getBridgeBatchDetail(batchId))
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load bridge batch')
    }
    finally {
      setLoading(false)
    }
  }, [batchId, opsApiKey])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <OpsPageShell
      actions={(
        <button className="ops-btn-ghost" disabled={!opsApiKey || loading} onClick={() => void load()} type="button">
          Refresh
        </button>
      )}
      backLink={{ label: 'Back to bridge settlement', to: '/ops/treasury/bridge' }}
      error={error}
      eyebrow="Money · Treasury · Bridge"
      keyRequiredMessage="Sign in to inspect bridge settlement evidence."
      subtitle="Read-only provider, SLA, reconciliation, and constituent transaction evidence for one settlement batch."
      title="Bridge batch"
    >
      {loading && !detail && <OpsLoading label="Loading bridge batch evidence…" />}

      {detail && (
        <div className="mt-8 space-y-6">
          <section aria-labelledby="batch-summary-heading" className="ops-card p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="ops-label">Settlement summary</div>
                <h2 className="mt-1 text-xl font-semibold" id="batch-summary-heading">
                  {formatAmount(detail.batch.grossAmount)}
                  {' '}
                  {detail.batch.asset}
                  {' → '}
                  {detail.batch.destNetwork}
                </h2>
                <div className="mt-2 font-mono text-xs text-ops-muted break-all">{detail.batch.id}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <OpsStatusBadge label={humanize(detail.batch.status)} tone={detail.batch.status === 'FAILED' ? 'danger' : detail.batch.status === 'CREDITED' ? 'success' : 'info'} />
                <OpsStatusBadge label={humanize(detail.batch.slaState)} tone={slaTone[detail.batch.slaState]} />
                <OpsStatusBadge
                  label={humanize(detail.batch.reconciliationState)}
                  tone={reconciliationTone[detail.batch.reconciliationState]}
                />
              </div>
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="ops-label">Settlement legs</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{detail.batch.memberCount}</dd>
              </div>
              <div>
                <dt className="ops-label">Expected by</dt>
                <dd className="mt-1 text-sm font-medium">{formatDateTime(detail.batch.expectedSlaAt)}</dd>
              </div>
              <div>
                <dt className="ops-label">Provider reference</dt>
                <dd className="mt-1 font-mono text-xs break-all">{detail.providerReference ?? 'Not assigned'}</dd>
              </div>
              <div>
                <dt className="ops-label">Provider fee</dt>
                <dd className="mt-1 text-sm font-medium tabular-nums">
                  {formatAmount(detail.batch.withdrawFee)}
                  {' '}
                  {detail.batch.asset}
                </dd>
              </div>
            </dl>
            {detail.batch.failureCategory && (
              <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                Provider settlement failed. Review the linked incident and runbook before any recovery action.
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="ops-btn-ghost ops-btn-sm" to={detail.batch.incidentPath}>Related incidents</Link>
              <Link className="ops-btn-ghost ops-btn-sm" to={detail.batch.runbookPath}>
                Bridge runbook
                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>

          <section aria-labelledby="batch-members-heading">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="ops-label">Constituent evidence</div>
                <h2 className="mt-1 text-lg font-semibold" id="batch-members-heading">Settlement legs</h2>
              </div>
              <span className="text-xs text-ops-muted">
                {detail.members.length}
                {' '}
                legs
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {detail.members.length === 0 && <OpsEmptyState>This batch has no constituent legs.</OpsEmptyState>}
              {detail.members.map(member => (
                <article className="ops-card p-4" key={member.id}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <OpsStatusBadge label={humanize(member.status)} tone={legTone[member.status]} />
                        <OpsStatusBadge label={humanize(member.slaState)} tone={slaTone[member.slaState]} />
                        <OpsStatusBadge
                          label={humanize(member.reconciliationState)}
                          tone={reconciliationTone[member.reconciliationState]}
                        />
                      </div>
                      <div className="mt-3 text-sm font-semibold">
                        {formatAmount(member.amount)}
                        {' '}
                        {member.asset}
                        {' → '}
                        {member.destNetwork}
                      </div>
                      {member.transaction && (
                        <div className="mt-1 text-xs text-ops-muted">
                          {member.transaction.partner.name}
                          {' · transaction '}
                          {humanize(member.transaction.status)}
                        </div>
                      )}
                      <div className="mt-2 font-mono text-[11px] text-ops-muted break-all">{member.id}</div>
                    </div>
                    <div className="text-xs text-ops-muted md:text-right">
                      <div>
                        Expected by
                        {formatDateTime(member.expectedSlaAt)}
                      </div>
                      <div>
                        Updated
                        {formatDateTime(member.updatedAt)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
                        {member.transaction && (
                          <Link className="ops-btn-ghost ops-btn-sm" to={`/ops/transactions/${encodeURIComponent(member.transaction.id)}`}>
                            Open transaction
                          </Link>
                        )}
                        <Link className="ops-btn-ghost ops-btn-sm" to={member.incidentPath}>Incidents</Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </OpsPageShell>
  )
}

export default OpsBridgeBatchDetailPage
