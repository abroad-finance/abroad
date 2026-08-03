import {
  Check,
  CircleDot,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  WalletCards,
} from 'lucide-react'
import { useState } from 'react'

import type { OpsRefundRecovery } from '../../../services/admin/transactionAdminTypes'

import {
  issueReplacementRefund,
  reconcileRefundRecovery,
} from '../../../services/admin/transactionAdminApi'
import {
  formatAmount,
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsStatusBadge,
  OpsTone,
} from '../shared'
import { isOpsMutationCancelledError, useOpsMutation } from '../shared/opsMutationContext'

type ProofStep = {
  description: string
  label: string
  state: ProofStepState
}

type ProofStepState = 'blocked' | 'complete' | 'current'

type RefundRecoveryPanelProps = {
  canRecover: boolean
  onChanged: (recovery: OpsRefundRecovery) => Promise<void> | void
  recovery: OpsRefundRecovery
}

const postureTone: Readonly<Record<OpsRefundRecovery['status'], OpsTone>> = {
  AMBIGUOUS: 'warning',
  BLOCKED: 'danger',
  COMPLETED: 'success',
  ELIGIBLE: 'success',
  IN_FLIGHT: 'info',
  NEEDS_RECONCILIATION: 'warning',
  NOT_REQUIRED: 'neutral',
  UNSUPPORTED: 'neutral',
}

const proofSteps = (recovery: OpsRefundRecovery): ProofStep[] => {
  const originalKnown = Boolean(recovery.candidateHashFingerprint)
  const reconciled = Boolean(recovery.lastReconciliation)
  const replacementAttempted = recovery.attempts > 1
  return [
    {
      description: originalKnown ? 'A durable transaction identity is available.' : 'No verifiable original hash is available.',
      label: 'Original attempt',
      state: originalKnown ? 'complete' : 'blocked',
    },
    {
      description: recovery.lastReconciliation
        ? `${humanizeStatus(recovery.lastReconciliation.result)} · ${formatDateTime(recovery.lastReconciliation.at)}`
        : 'Exact-hash chain evidence is still required.',
      label: 'Chain proof',
      state: reconciled
        ? recovery.lastReconciliation?.result === 'AMBIGUOUS' ? 'current' : 'complete'
        : originalKnown ? 'current' : 'blocked',
    },
    {
      description: replacementAttempted
        ? 'A signed replacement was persisted before submission.'
        : recovery.replacementEligible
          ? 'Fresh absence proof permits one guarded replacement.'
          : 'Unavailable until every prior hash is safe.',
      label: 'Replacement',
      state: replacementAttempted || recovery.replacementEligible
        ? recovery.canonicalRefundRecorded ? 'complete' : 'current'
        : 'blocked',
    },
    {
      description: recovery.canonicalRefundRecorded
        ? 'Canonical refund evidence is recorded.'
        : 'Completion requires authoritative chain confirmation.',
      label: 'Verified complete',
      state: recovery.canonicalRefundRecorded ? 'complete' : 'blocked',
    },
  ]
}

const ProofStepItem = ({
  description,
  index,
  label,
  state,
}: ProofStep & { index: number }) => (
  <li className="relative min-w-0 rounded-2xl border border-ops-border bg-white p-4">
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
          state === 'complete'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : state === 'current'
              ? 'border-amber-500 bg-amber-50 text-amber-800'
              : 'border-slate-300 bg-slate-100 text-slate-500'
        }`}
      >
        {state === 'complete' ? <Check size={15} /> : index + 1}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ops-text">{label}</p>
        <p className="mt-1 text-xs leading-5 text-ops-muted">{description}</p>
      </div>
    </div>
  </li>
)

const outcomeMessage = (recovery: OpsRefundRecovery): string => {
  if (recovery.status === 'COMPLETED') return 'The refund is confirmed and its canonical evidence is recorded.'
  if (recovery.status === 'ELIGIBLE') return 'Every prior refund hash is definitively absent. A replacement is now eligible.'
  if (recovery.status === 'AMBIGUOUS') return 'The result remains ambiguous. No replacement can be submitted yet.'
  if (recovery.status === 'IN_FLIGHT') return 'The durable refund attempt is in flight and must be reconciled.'
  return 'Refund recovery evidence was refreshed.'
}

const RefundRecoveryPanel = ({ canRecover, onChanged, recovery }: RefundRecoveryPanelProps) => {
  const { requestMutation } = useOpsMutation()
  const [error, setError] = useState<null | string>(null)
  const [notice, setNotice] = useState<null | string>(null)
  const [operation, setOperation] = useState<'reconcile' | 'replace' | null>(null)
  const steps = proofSteps(recovery)
  const actionLabel = `${recovery.amount === null ? 'Unknown amount' : formatAmount(recovery.amount)} ${recovery.asset} · ${humanizeStatus(recovery.network)}`
  const reconcileDisabled = operation !== null
    || !canRecover
    || recovery.status === 'BLOCKED'
    || recovery.status === 'COMPLETED'
    || recovery.status === 'NOT_REQUIRED'
    || recovery.status === 'UNSUPPORTED'

  const runReconciliation = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setOperation('reconcile')
    try {
      const next = await requestMutation({
        action: 'transaction.refund.reconcile',
        execute: details => reconcileRefundRecovery(recovery.transactionId, details),
        expectedVersion: recovery.version,
        resourceLabel: actionLabel,
        title: 'Reconcile every refund hash',
      })
      await onChanged(next)
      setNotice(outcomeMessage(next))
    }
    catch (reconcileError) {
      if (!isOpsMutationCancelledError(reconcileError)) {
        setError(reconcileError instanceof Error ? reconcileError.message : 'Refund reconciliation failed')
      }
    }
    finally {
      setOperation(null)
    }
  }

  const runReplacement = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setOperation('replace')
    try {
      const next = await requestMutation({
        action: 'transaction.refund.replace',
        execute: details => issueReplacementRefund(recovery.transactionId, details),
        expectedVersion: recovery.version,
        resourceLabel: actionLabel,
        title: 'Issue one replacement refund',
      })
      await onChanged(next)
      setNotice(outcomeMessage(next))
    }
    catch (replacementError) {
      if (!isOpsMutationCancelledError(replacementError)) {
        setError(replacementError instanceof Error ? replacementError.message : 'Replacement refund failed')
      }
    }
    finally {
      setOperation(null)
    }
  }

  return (
    <section aria-labelledby="refund-recovery-title" className="ops-card overflow-hidden">
      <div className="border-b border-ops-border bg-gradient-to-br from-slate-50 via-white to-emerald-50/50 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <WalletCards aria-hidden size={20} />
            </span>
            <div className="min-w-0">
              <p className="ops-eyebrow">Exactly-once financial recovery</p>
              <h2 className="mt-1 text-xl font-semibold text-ops-text" id="refund-recovery-title">Refund recovery</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-ops-muted">
                Reconcile every durable hash first. The amount and sender are derived from the original deposit and cannot be edited here.
              </p>
            </div>
          </div>
          <OpsStatusBadge label={humanizeStatus(recovery.status)} tone={postureTone[recovery.status]} />
        </div>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <ol aria-label="Refund recovery proof" className="grid min-w-0 gap-3 lg:grid-cols-4">
          {steps.map((step, index) => <ProofStepItem {...step} index={index} key={step.label} />)}
        </ol>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-ops-border bg-ops-bg/60 p-3">
            <p className="ops-label">Exact refund</p>
            <p className="mt-1.5 text-sm font-semibold text-ops-text">{actionLabel}</p>
          </div>
          <div className="rounded-xl border border-ops-border bg-ops-bg/60 p-3">
            <p className="ops-label">Recorded attempts</p>
            <p className="mt-1.5 text-sm font-semibold text-ops-text">{recovery.attempts}</p>
          </div>
          <div className="rounded-xl border border-ops-border bg-ops-bg/60 p-3">
            <p className="ops-label">Candidate hash</p>
            <p className="mt-1.5 break-words font-mono text-sm font-semibold text-ops-text">{recovery.candidateHashFingerprint ?? 'Not available'}</p>
          </div>
          <div className="rounded-xl border border-ops-border bg-ops-bg/60 p-3">
            <p className="ops-label">Last failure</p>
            <p className="mt-1.5 text-sm font-semibold text-ops-text">{recovery.lastFailureCategory ? humanizeStatus(recovery.lastFailureCategory) : 'Not classified'}</p>
          </div>
        </div>

        {recovery.blockReason && (
          <OpsBanner variant={recovery.status === 'UNSUPPORTED' ? 'warning' : 'error'}>
            {recovery.blockReason}
          </OpsBanner>
        )}
        {recovery.status === 'AMBIGUOUS' && (
          <OpsBanner variant="warning">
            <span className="flex items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 shrink-0" size={16} />
              A prior signed transaction may still settle. Reconcile again after finality; creating another refund is blocked.
            </span>
          </OpsBanner>
        )}
        {recovery.replacementEligible && (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
            <div className="flex gap-3">
              <ShieldCheck aria-hidden className="mt-0.5 shrink-0 text-emerald-700" size={20} />
              <div>
                <p className="font-semibold text-emerald-950">Replacement eligibility proven</p>
                <p className="mt-1 text-sm leading-6 text-emerald-900">Every known hash is absent after expiry. The server will recheck immediately before signing.</p>
              </div>
            </div>
          </div>
        )}
        {!canRecover && (
          <OpsBanner variant="warning">Operations or Finance refund permission and a named, freshly verified session are required.</OpsBanner>
        )}
        {error && <OpsBanner variant="error">{error}</OpsBanner>}
        {notice && <OpsBanner variant="success">{notice}</OpsBanner>}

        <div className="grid gap-3 sm:grid-cols-2">
          <button className="ops-btn-neutral min-h-11 w-full" disabled={reconcileDisabled} onClick={() => void runReconciliation()} type="button">
            {operation === 'reconcile' ? <CircleDot aria-hidden className="animate-pulse" size={16} /> : <RefreshCw aria-hidden size={16} />}
            {operation === 'reconcile' ? 'Reconciling exact hashes…' : 'Reconcile refund'}
          </button>
          <button
            className="ops-btn-primary min-h-11 w-full"
            disabled={operation !== null || !canRecover || !recovery.replacementEligible}
            onClick={() => void runReplacement()}
            type="button"
          >
            <RotateCcw aria-hidden size={16} />
            {operation === 'replace' ? 'Persisting and submitting…' : 'Issue replacement refund'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default RefundRecoveryPanel
