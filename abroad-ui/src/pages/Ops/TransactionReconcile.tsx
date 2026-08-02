import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
  OpsTransactionListResponse,
} from '../../services/admin/transactionAdminTypes'

import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  reconcileTransactionHash,
  searchTransactions,
} from '../../services/admin/transactionAdminApi'
import {
  humanizeStatus,
  OpsBanner,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'
import TransactionSummaryCard from './transactions/TransactionSummaryCard'

type ReconciliationBlockchain = OpsReconcileTransactionHashInput['blockchain']

const resultTone: Readonly<Record<OpsReconcileTransactionHashResponse['result'], OpsTone>> = {
  alreadyProcessed: 'neutral',
  enqueued: 'success',
  failed: 'danger',
  invalid: 'warning',
  notFound: 'warning',
  unresolved: 'info',
}

const TransactionReconcile = () => {
  const [searchParams] = useSearchParams()
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const requestedTransactionId = searchParams.get('transactionId')?.trim() ?? ''
  const [blockchain, setBlockchain] = useState<ReconciliationBlockchain>('STELLAR')
  const [onChainTx, setOnChainTx] = useState('')
  const [transactionId, setTransactionId] = useState(requestedTransactionId)
  const [queue, setQueue] = useState<null | OpsTransactionListResponse>(null)
  const [queueLoading, setQueueLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [result, setResult] = useState<null | OpsReconcileTransactionHashResponse>(null)
  const canReconcile = Boolean(session?.kind === 'ops_user' && session.permissions.includes('transactions:reconcile'))

  useEffect(() => setTransactionId(requestedTransactionId), [requestedTransactionId])

  const loadQueue = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!opsApiKey) {
      setQueue(null)
      return
    }
    setQueueLoading(true)
    setError(null)
    try {
      setQueue(await searchTransactions({ attention: 'ALL', page: 1, pageSize: 20 }, signal))
    }
    catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load reconciliation exceptions')
      }
    }
    finally {
      if (!signal?.aborted) setQueueLoading(false)
    }
  }, [opsApiKey])

  useEffect(() => {
    const controller = new AbortController()
    void loadQueue(controller.signal)
    return () => controller.abort()
  }, [loadQueue])

  const isSubmitDisabled = useMemo(() => (
    !canReconcile || submitting || onChainTx.trim().length === 0
  ), [
    canReconcile,
    onChainTx,
    submitting,
  ])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (isSubmitDisabled) return
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        blockchain,
        on_chain_tx: onChainTx.trim(),
        transaction_id: transactionId.trim() || undefined,
      }
      const response = await requestMutation({
        action: 'transaction.reconcile_hash',
        execute: mutation => reconcileTransactionHash(payload, mutation),
        resourceLabel: `${blockchain} · ${onChainTx.trim().slice(0, 12)}…`,
        title: 'Reconcile on-chain evidence',
      })
      setResult(response)
      await loadQueue()
    }
    catch (submitError) {
      if (isOpsMutationCancelledError(submitError)) return
      setResult(null)
      setError(submitError instanceof Error ? submitError.message : 'Reconciliation request failed')
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost min-h-11"
          disabled={!opsApiKey || queueLoading}
          onClick={() => void loadQueue()}
          type="button"
        >
          <RefreshCw aria-hidden size={16} />
          Refresh exceptions
        </button>
      )}
      error={error}
      eyebrow="Work · Reconciliation"
      keyRequiredMessage="Sign in to review reconciliation exceptions."
      subtitle="Investigate the exception first. Repair only missing blockchain evidence after verifying the transaction and chain reference."
      title="Reconciliation review"
      width="full"
    >
      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <section aria-labelledby="exception-queue-title" className="min-w-0">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="ops-eyebrow">Investigation queue</p>
              <h2 className="mt-1 text-xl font-semibold text-ops-text" id="exception-queue-title">
                Transactions needing evidence review
              </h2>
              <p className="mt-1 text-sm text-ops-muted">
                Failed payments, missing proof, pending refunds, webhook failures, and failed flows.
              </p>
            </div>
            {queue && (
              <span className="text-sm font-semibold text-ops-muted">
                {queue.total}
                {' '}
                open
              </span>
            )}
          </div>

          <div aria-busy={queueLoading} className="mt-4 space-y-3">
            {queueLoading && !queue && <OpsLoading label="Loading reconciliation exceptions…" />}
            {!queueLoading && queue?.items.length === 0 && (
              <OpsEmptyState>
                <div>
                  <p className="font-semibold text-ops-text">No current reconciliation exceptions.</p>
                  <p className="mt-1 text-sm">Use global search when investigating a specific partner report.</p>
                  <Link className="mt-3 inline-flex font-semibold text-ops-brand underline underline-offset-4" to="/ops/search">Open global search</Link>
                </div>
              </OpsEmptyState>
            )}
            {queue?.items.map(item => <TransactionSummaryCard key={item.id} transaction={item} />)}
          </div>
        </section>

        <aside aria-labelledby="repair-title" className="min-w-0">
          <div className="ops-card sticky top-5 overflow-hidden">
            <div className="border-b border-ops-border bg-amber-50 p-5">
              <div className="flex items-center gap-2 text-amber-900">
                <Wrench aria-hidden size={19} />
                <h2 className="text-lg font-semibold" id="repair-title">Repair chain evidence</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                This checks and links an on-chain payment, then may enqueue normal processing. It does not directly send a payout or refund.
              </p>
            </div>

            <form className="space-y-4 p-5" onSubmit={event => void handleSubmit(event)}>
              <OpsBanner variant="warning">
                Confirm the hash on the selected network and open the transaction case before repair. Reusing a processed hash is idempotent; a mismatched hash is rejected.
              </OpsBanner>
              <OpsField label="Blockchain network">
                <select
                  className="ops-input min-h-11"
                  onChange={event => setBlockchain(event.target.value as ReconciliationBlockchain)}
                  value={blockchain}
                >
                  <option value="STELLAR">Stellar</option>
                  <option value="SOLANA">Solana</option>
                  <option value="CELO">Celo</option>
                </select>
              </OpsField>
              <OpsField hint="Required for unresolved Solana or Celo evidence." label="Abroad transaction ID (optional)">
                <input
                  className="ops-input min-h-11"
                  onChange={event => setTransactionId(event.target.value)}
                  placeholder="Paste transaction ID"
                  value={transactionId}
                />
              </OpsField>
              <OpsField hint="Use the canonical transaction hash or signature from the selected network." label="On-chain hash or signature">
                <input
                  className="ops-input min-h-11"
                  onChange={event => setOnChainTx(event.target.value)}
                  placeholder="Paste chain evidence"
                  required
                  value={onChainTx}
                />
              </OpsField>
              {!canReconcile && (
                <OpsBanner variant="warning">A named operator with reconciliation permission is required.</OpsBanner>
              )}
              <button className="ops-btn-primary min-h-11 w-full" disabled={isSubmitDisabled} type="submit">
                <ShieldCheck aria-hidden size={16} />
                {submitting ? 'Reviewing evidence…' : 'Review and reconcile'}
              </button>
            </form>

            {result && (
              <div className="border-t border-ops-border p-5" role="status">
                <div className="flex items-center justify-between gap-3">
                  <OpsStatusBadge label={humanizeStatus(result.result)} tone={resultTone[result.result]} />
                  {result.result === 'enqueued'
                    ? <CheckCircle2 aria-hidden className="text-emerald-700" size={18} />
                    : <AlertTriangle aria-hidden className="text-amber-700" size={18} />}
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="ops-label">Result</dt>
                    <dd className="mt-1 text-ops-text">{result.reason ?? humanizeStatus(result.result)}</dd>
                  </div>
                  <div>
                    <dt className="ops-label">Transaction</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-ops-text">{result.transaction_id ?? 'Not resolved'}</dd>
                  </div>
                  <div>
                    <dt className="ops-label">Transaction state</dt>
                    <dd className="mt-1 text-ops-text">{result.transaction_status ? humanizeStatus(result.transaction_status) : 'Not available'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </aside>
      </div>
    </OpsPageShell>
  )
}

export default TransactionReconcile
