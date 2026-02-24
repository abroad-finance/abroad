import { FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { reconcileTransactionHash } from '../../services/admin/transactionAdminApi'
import {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
  reconciliationBlockchains,
} from '../../services/admin/transactionAdminTypes'
import OpsApiKeyPanel from './OpsApiKeyPanel'

type ReconciliationBlockchain = OpsReconcileTransactionHashInput['blockchain']

const resultClasses: Record<OpsReconcileTransactionHashResponse['result'], string> = {
  alreadyProcessed: 'bg-slate-100 text-slate-700 border-slate-200',
  enqueued: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed: 'bg-rose-100 text-rose-800 border-rose-200',
  invalid: 'bg-amber-100 text-amber-800 border-amber-200',
  notFound: 'bg-orange-100 text-orange-800 border-orange-200',
  unresolved: 'bg-indigo-100 text-indigo-800 border-indigo-200',
}

const TransactionReconcile = () => {
  const opsApiKey = useOpsApiKey()
  const [blockchain, setBlockchain] = useState<ReconciliationBlockchain>('STELLAR')
  const [onChainTx, setOnChainTx] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [result, setResult] = useState<null | OpsReconcileTransactionHashResponse>(null)

  const isSubmitDisabled = useMemo(() => (
    !opsApiKey || submitting || onChainTx.trim().length === 0
  ), [
    onChainTx,
    opsApiKey,
    submitting,
  ])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitDisabled) return

    setSubmitting(true)
    setError(null)

    try {
      const response = await reconcileTransactionHash({
        blockchain,
        on_chain_tx: onChainTx.trim(),
        transaction_id: transactionId.trim() || undefined,
      })
      setResult(response)
    }
    catch (submitError) {
      setResult(null)
      setError(submitError instanceof Error ? submitError.message : 'Reconciliation request failed')
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#1A1A1A]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-4xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-sm uppercase tracking-[0.3em] text-[#356E6A]">Operations</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Transaction Hash Reconcile</h1>
              <p className="text-sm text-[#4B5563] max-w-xl mt-2">
                Trigger blockchain hash reconciliation through OPS-only controls.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                className="px-4 py-2 rounded-xl border border-[#356E6A] text-[#356E6A] bg-white/70 hover:bg-white transition text-sm font-medium"
                to="/ops/flows"
              >
                Flow Control Room
              </Link>
              <Link
                className="px-4 py-2 rounded-xl border border-[#356E6A] text-[#356E6A] bg-white/70 hover:bg-white transition text-sm font-medium"
                to="/ops/partners"
              >
                Partners
              </Link>
            </div>
          </div>

          <OpsApiKeyPanel />

          {!opsApiKey && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to reconcile transaction hashes.
            </div>
          )}

          <form
            className="mt-8 rounded-2xl border border-white/70 bg-white/80 backdrop-blur p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)] space-y-4"
            onSubmit={(event) => {
              void handleSubmit(event)
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col">
                <span className="text-xs uppercase tracking-wider text-[#5B6B6A]">Blockchain</span>
                <select
                  className="mt-2 rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                  onChange={event => setBlockchain(event.target.value as ReconciliationBlockchain)}
                  value={blockchain}
                >
                  {reconciliationBlockchains.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-xs uppercase tracking-wider text-[#5B6B6A]">Transaction ID (optional)</span>
                <input
                  className="mt-2 rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                  onChange={event => setTransactionId(event.target.value)}
                  placeholder="UUID (required for unresolved SOLANA/CELO hashes)"
                  value={transactionId}
                />
              </label>
            </div>
            <label className="flex flex-col">
              <span className="text-xs uppercase tracking-wider text-[#5B6B6A]">On-chain hash / signature</span>
              <input
                className="mt-2 rounded-xl border border-[#DADADA] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40"
                onChange={event => setOnChainTx(event.target.value)}
                placeholder="Paste tx hash/signature"
                value={onChainTx}
              />
            </label>
            <div className="text-xs text-[#6B7280]">
              This endpoint does not use heuristic matching. If SOLANA/CELO hash is not linked yet, provide
              {' '}
              <code>transaction_id</code>
              .
            </div>
            <div className="flex justify-end">
              <button
                className="rounded-xl border border-[#356E6A] bg-[#356E6A] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B5B57] transition disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitDisabled}
                type="submit"
              >
                {submitting ? 'Reconciling...' : 'Reconcile Hash'}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-6 rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between gap-3">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${resultClasses[result.result]}`}>
                  {result.result}
                </span>
                <span className="text-xs uppercase tracking-wider text-[#64748B]">{result.blockchain}</span>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-[#6B7280]">On-chain</dt>
                  <dd className="font-mono break-all">{result.on_chain_tx}</dd>
                </div>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-[#6B7280]">Transaction ID</dt>
                  <dd>{result.transaction_id ?? '—'}</dd>
                </div>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-[#6B7280]">Transaction Status</dt>
                  <dd>{result.transaction_status ?? '—'}</dd>
                </div>
                <div className="grid grid-cols-[130px_1fr] gap-2">
                  <dt className="text-[#6B7280]">Reason</dt>
                  <dd>{result.reason ?? '—'}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransactionReconcile
