import {
  ArrowLeft, CheckCircle2, CircleDashed, DatabaseZap, LoaderCircle, Play, RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { PartnerReconciliationRun } from '../../services/partnerPortal/partnerPortalTypes'

import {
  continuePartnerPixReconciliation,
  listPartnerPixReconciliations,
  startPartnerPixReconciliation,
} from '../../services/partnerPortal/partnerPortalApi'
import { usePartnerPortalSession } from '../../services/partnerPortal/partnerPortalSessionStore'
import { formatPartnerDateTime, shortTransactionId } from './partnerPortalPresentation'
import { PartnerNotice } from './partnerPortalUi'

const runStatus = (run: PartnerReconciliationRun): { className: string, label: string } => {
  if (run.status === 'COMPLETED') return { className: 'bg-emerald-50 text-emerald-700', label: 'Completed' }
  if (run.status === 'COMPLETED_WITH_ERRORS') return { className: 'bg-amber-50 text-amber-800', label: 'Completed with exceptions' }
  return { className: 'bg-sky-50 text-sky-700', label: 'Ready for next batch' }
}

const PartnerPortalReconciliation = () => {
  const session = usePartnerPortalSession()
  const authorized = session?.role === 'ADMIN' && session.mfaVerified
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [pendingRunId, setPendingRunId] = useState<null | string>(null)
  const [runs, setRuns] = useState<PartnerReconciliationRun[]>([])

  const load = useCallback(async () => {
    if (!authorized) return
    setLoading(true)
    setError(null)
    try {
      setRuns(await listPartnerPixReconciliations())
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load reconciliation history')
    }
    finally {
      setLoading(false)
    }
  }, [authorized])

  useEffect(() => {
    void load()
  }, [load])

  const process = async (runId?: string) => {
    setPendingRunId(runId ?? 'new')
    setError(null)
    try {
      const result = runId
        ? await continuePartnerPixReconciliation(runId)
        : await startPartnerPixReconciliation(5)
      setRuns(current => [result, ...current.filter(run => run.id !== result.id)])
    }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reconciliation batch could not be processed')
    }
    finally {
      setPendingRunId(null)
    }
  }

  if (!authorized) {
    return (
      <div className="partner-empty-state min-h-64 flex-col text-center">
        <DatabaseZap aria-hidden className="h-7 w-7 text-partner-forest" />
        <div>
          <h1 className="text-xl font-semibold text-partner-ink">Administrator verification required</h1>
          <p className="mt-2 text-sm text-partner-muted">Enable and verify MFA before running PIX reconciliation.</p>
        </div>
        <Link className="partner-button-primary" to="/partner/security">Open security settings</Link>
      </div>
    )
  }

  return (
    <>
      <Link className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-partner-forest hover:text-partner-ink" to="/partner/transactions">
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Back to transactions
      </Link>
      <header className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="partner-eyebrow">Transaction records</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-partner-ink sm:text-5xl">PIX reconciliation</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-partner-muted sm:text-base">Recover missing PIX E2E identifiers from settled Transfero Ultra withdrawals in bounded, resumable five-record batches. Transaction status and funds are never changed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="partner-button-secondary" disabled={loading || pendingRunId !== null} onClick={() => void load()} type="button">
            <RefreshCw aria-hidden className="h-4 w-4" />
            Refresh
          </button>
          <button className="partner-button-primary" disabled={pendingRunId !== null} onClick={() => void process()} type="button">
            {pendingRunId === 'new' ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Play aria-hidden className="h-4 w-4" />}
            Start run
          </button>
        </div>
      </header>

      <div className="mt-6"><PartnerNotice tone="neutral">Only eligible Ultra-era PIX records with a provider withdrawal ID and no stored E2E ID are read. Conflicts are surfaced for review and never overwritten.</PartnerNotice></div>
      {error && <div aria-live="polite" className="mt-4"><PartnerNotice tone="error">{error}</PartnerNotice></div>}

      <section aria-labelledby="reconciliation-history-title" className="mt-8 space-y-4">
        <h2 className="text-xl font-semibold text-partner-ink" id="reconciliation-history-title">Run history</h2>
        {loading && runs.length === 0 && (
          <div className="partner-empty-state">
            <LoaderCircle aria-hidden className="h-5 w-5 animate-spin" />
            Loading reconciliation runs…
          </div>
        )}
        {!loading && runs.length === 0 && (
          <div className="partner-empty-state">
            <CircleDashed aria-hidden className="h-5 w-5" />
            No reconciliation has been run for this partner.
          </div>
        )}
        {runs.map((run) => {
          const meta = runStatus(run)
          return (
            <article className="partner-section" key={run.id}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-sm font-semibold text-partner-ink">
                      Run
                      {shortTransactionId(run.id)}
                    </h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
                  </div>
                  <p className="mt-2 text-xs text-partner-muted">{`Started ${formatPartnerDateTime(run.createdAt)}${run.completedAt ? ` · completed ${formatPartnerDateTime(run.completedAt)}` : ''}`}</p>
                </div>
                {run.status === 'RUNNING' && (
                  <button className="partner-button-primary" disabled={pendingRunId !== null} onClick={() => void process(run.id)} type="button">
                    {pendingRunId === run.id ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <Play aria-hidden className="h-4 w-4" />}
                    Process next 5
                  </button>
                )}
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  ['Processed', run.processedCount],
                  ['Updated', run.updatedCount],
                  ['Unchanged', run.unchangedCount],
                  ['Ineligible', run.ineligibleCount],
                  ['Failed', run.failureCount],
                ].map(([label, value]) => (
                  <div className="rounded-xl bg-partner-ledger p-3" key={String(label)}>
                    <dt className="partner-label">{label}</dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums text-partner-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              {run.items.length > 0 && (
                <ul className="mt-5 divide-y divide-partner-border rounded-2xl border border-partner-border">
                  {run.items.map(item => (
                    <li className="flex flex-wrap items-center justify-between gap-3 p-3" key={item.transactionId}>
                      <div className="flex items-center gap-3">
                        {item.status === 'UPDATED' || item.status === 'UNCHANGED' ? <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-600" /> : <CircleDashed aria-hidden className="h-4 w-4 text-amber-700" />}
                        <Link className="font-mono text-xs font-semibold text-partner-forest hover:text-partner-ink" to={`/partner/transactions/${item.transactionId}`}>{shortTransactionId(item.transactionId)}</Link>
                      </div>
                      <span className="text-xs text-partner-muted">{item.failureCode ?? item.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          )
        })}
      </section>
    </>
  )
}

export default PartnerPortalReconciliation
