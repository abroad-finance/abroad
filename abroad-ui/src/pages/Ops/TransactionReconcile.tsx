import { useTranslate } from '@tolgee/react'
import { FormEvent, useMemo, useState } from 'react'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { reconcileTransactionHash } from '../../services/admin/transactionAdminApi'
import {
  OpsReconcileTransactionHashInput,
  OpsReconcileTransactionHashResponse,
  reconciliationBlockchains,
} from '../../services/admin/transactionAdminTypes'
import {
  OpsField,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'

type ReconciliationBlockchain = OpsReconcileTransactionHashInput['blockchain']

const resultTone: Record<OpsReconcileTransactionHashResponse['result'], OpsTone> = {
  alreadyProcessed: 'neutral',
  enqueued: 'success',
  failed: 'danger',
  invalid: 'warning',
  notFound: 'warning',
  unresolved: 'info',
}

const TransactionReconcile = () => {
  const { t } = useTranslate()
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
    <OpsPageShell
      error={error}
      eyebrow={t('ops.operations', 'Operations')}
      keyRequiredMessage="Ops API key required to reconcile transaction hashes."
      subtitle={t('ops.tx_reconcile_desc', 'Trigger blockchain hash reconciliation through OPS-only controls.')}
      title={t('ops.tx_reconcile_title', 'Transaction Hash Reconcile')}
    >
      <form
        className="ops-card mt-8 space-y-4 p-6"
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <OpsField label="Blockchain">
            <select
              className="ops-input"
              onChange={event => setBlockchain(event.target.value as ReconciliationBlockchain)}
              value={blockchain}
            >
              {reconciliationBlockchains.map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </OpsField>
          <OpsField label="Transaction ID (optional)">
            <input
              className="ops-input"
              onChange={event => setTransactionId(event.target.value)}
              placeholder="UUID (required for unresolved SOLANA/CELO hashes)"
              value={transactionId}
            />
          </OpsField>
        </div>
        <OpsField label="On-chain hash / signature">
          <input
            className="ops-input"
            onChange={event => setOnChainTx(event.target.value)}
            placeholder="Paste tx hash/signature"
            value={onChainTx}
          />
        </OpsField>
        <div className="text-xs text-ops-muted">
          This endpoint does not use heuristic matching. If SOLANA/CELO hash is not linked yet, provide
          {' '}
          <code>transaction_id</code>
          .
        </div>
        <div className="flex justify-end">
          <button
            className="ops-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitDisabled}
            type="submit"
          >
            {submitting ? 'Reconciling...' : 'Reconcile Hash'}
          </button>
        </div>
      </form>

      {result && (
        <div className="ops-card mt-6 p-6" role="status">
          <div className="flex items-center justify-between gap-3">
            <OpsStatusBadge label={result.result} tone={resultTone[result.result]} />
            <span className="text-xs uppercase tracking-wider text-ops-muted">{result.blockchain}</span>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="grid grid-cols-[130px_1fr] gap-2">
              <dt className="text-ops-muted">On-chain</dt>
              <dd className="font-mono break-all">{result.on_chain_tx}</dd>
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-2">
              <dt className="text-ops-muted">Transaction ID</dt>
              <dd>{result.transaction_id ?? '—'}</dd>
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-2">
              <dt className="text-ops-muted">Transaction Status</dt>
              <dd>{result.transaction_status ?? '—'}</dd>
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-2">
              <dt className="text-ops-muted">Reason</dt>
              <dd>{result.reason ?? '—'}</dd>
            </div>
          </dl>
        </div>
      )}
    </OpsPageShell>
  )
}

export default TransactionReconcile
