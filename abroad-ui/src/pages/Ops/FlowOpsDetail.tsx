import type { ReactNode } from 'react'

import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { useParams } from 'react-router-dom'

import {
  getFlowInstance,
  requeueFlowStep,
  resumeFlowInstance,
  retryFlowStep,
} from '../../services/admin/flowAdminApi'
import {
  FlowInstanceDetail,
  FlowInstanceStatus,
  FlowStepInstance,
  FlowStepStatus,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { cn } from '../../shared/utils'
import {
  formatAmount,
  formatDateTime,
  humanizeStatus,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  OpsTone,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

const flowStatusTone: Record<FlowInstanceStatus, OpsTone> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  IN_PROGRESS: 'info',
  NOT_STARTED: 'neutral',
  WAITING: 'warning',
}

const stepStatusTone: Record<FlowStepStatus, OpsTone> = {
  FAILED: 'danger',
  READY: 'neutral',
  RUNNING: 'info',
  SKIPPED: 'neutral',
  SUCCEEDED: 'success',
  WAITING: 'warning',
}

const formatJson = (value: unknown) => {
  if (!value) return '—'
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

const extractErrorMessage = (error: FlowStepInstance['error']): string => {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) {
    const message = error.message
    return typeof message === 'string' ? message : ''
  }
  return ''
}

const Field = ({ className, label, value }: {
  className?: string
  label: ReactNode
  value: ReactNode
}) => (
  <div className={cn('text-xs text-ops-muted', className)}>
    {label}
    :
    {' '}
    {value}
  </div>
)

const FlowOpsDetail = () => {
  const { flowInstanceId } = useParams()
  const [data, setData] = useState<FlowInstanceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()
  const { requestMutation } = useOpsMutation()

  const load = useCallback(async () => {
    if (!flowInstanceId || !opsApiKey) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    try {
      const result = await getFlowInstance(flowInstanceId)
      setData(result)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flow instance')
    }
    finally {
      setLoading(false)
    }
  }, [flowInstanceId, opsApiKey])

  useEffect(() => {
    void load()
  }, [load])

  const headerDefinition = useMemo(() => {
    if (!data?.definition) return '—'
    return `${data.definition.cryptoCurrency} · ${data.definition.blockchain} → ${data.definition.targetCurrency}`
  }, [data?.definition])

  const handleAction = useCallback(async (step: FlowStepInstance, action: 'requeue' | 'retry') => {
    if (!flowInstanceId || !opsApiKey) return
    const key = `${action}-${step.id}`
    setActionLoading(key)
    setError(null)

    try {
      if (action === 'retry') {
        await requestMutation({
          action: 'flow.step.retry',
          execute: mutation => retryFlowStep(flowInstanceId, step.id, mutation),
          resourceLabel: `Step ${step.stepOrder} · ${step.stepType}`,
          title: 'Retry failed flow step',
        })
      }
      else {
        await requestMutation({
          action: 'flow.step.requeue',
          execute: mutation => requeueFlowStep(flowInstanceId, step.id, mutation),
          resourceLabel: `Step ${step.stepOrder} · ${step.stepType}`,
          title: 'Requeue flow step',
        })
      }
      await load()
    }
    catch (err) {
      if (isOpsMutationCancelledError(err)) return
      setError(err instanceof Error ? err.message : 'Action failed')
    }
    finally {
      setActionLoading(null)
    }
  }, [
    flowInstanceId,
    load,
    opsApiKey,
    requestMutation,
  ])

  const handleResume = useCallback(async () => {
    if (!flowInstanceId || !opsApiKey) return
    setActionLoading('resume')
    setError(null)

    try {
      await requestMutation({
        action: 'flow.resume',
        execute: mutation => resumeFlowInstance(flowInstanceId, mutation),
        resourceLabel: flowInstanceId,
        title: 'Resume failed flow',
      })
      await load()
    }
    catch (err) {
      if (isOpsMutationCancelledError(err)) return
      setError(err instanceof Error ? err.message : 'Resume failed')
    }
    finally {
      setActionLoading(null)
    }
  }, [
    flowInstanceId,
    load,
    opsApiKey,
    requestMutation,
  ])

  const handleForceReset = useCallback(async (step: FlowStepInstance) => {
    if (!flowInstanceId || !opsApiKey) return
    const key = `force-${step.id}`
    setActionLoading(key)
    setError(null)

    try {
      await requestMutation({
        action: 'flow.step.force_retry',
        execute: mutation => retryFlowStep(flowInstanceId, step.id, mutation, { force: true }),
        resourceLabel: `Running step ${step.stepOrder} · ${step.stepType}`,
        title: 'Force retry running step',
      })
      await load()
    }
    catch (err) {
      if (isOpsMutationCancelledError(err)) return
      setError(err instanceof Error ? err.message : 'Force reset failed')
    }
    finally {
      setActionLoading(null)
    }
  }, [
    flowInstanceId,
    load,
    opsApiKey,
    requestMutation,
  ])

  return (
    <OpsPageShell
      actions={data && (
        <>
          <OpsStatusBadge label={humanizeStatus(data.status)} tone={flowStatusTone[data.status]} />
          <div className="text-xs text-ops-muted">
            Updated
            {' '}
            {formatDateTime(data.updatedAt)}
          </div>
          {data.status === 'FAILED' && (
            <button
              className="ops-btn-primary"
              disabled={actionLoading === 'resume' || !opsApiKey}
              onClick={() => void handleResume()}
              type="button"
            >
              {actionLoading === 'resume' ? 'Resuming...' : 'Resume Flow'}
            </button>
          )}
        </>
      )}
      backLink={{ label: 'Back to flows', to: '/ops/flows' }}
      error={error}
      eyebrow="Flow Instance"
      keyRequiredMessage="Ops API key required to load flow details."
      subtitle={flowInstanceId}
      title={headerDefinition}
    >
      {loading && opsApiKey && (
        <OpsLoading label="Loading flow instance…" />
      )}

      {data && opsApiKey && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="ops-card p-5">
              <div className="ops-label">Transaction</div>
              <div className="mt-2 text-sm font-medium">{data.transaction?.id ?? '—'}</div>
              <Field className="mt-1" label="Status" value={humanizeStatus(data.transaction?.status)} />
              <Field className="mt-3" label="External ID" value={data.transaction?.externalId ?? '—'} />
              <Field label="On-chain" value={data.transaction?.onChainId ?? '—'} />
            </div>
            <div className="ops-card p-5">
              <div className="ops-label">Amounts</div>
              <div className="mt-2 text-sm font-medium">
                Source:
                {' '}
                {formatAmount(data.transaction?.quote.sourceAmount)}
              </div>
              <Field
                label="Target"
                value={(
                  <>
                    {formatAmount(data.transaction?.quote.targetAmount)}
                    {' '}
                    {data.transaction?.quote.targetCurrency ?? ''}
                  </>
                )}
              />
              <Field className="mt-3" label="Network" value={data.transaction?.quote.network ?? '—'} />
              <Field label="Payment" value={data.transaction?.paymentMethod ?? '—'} />
            </div>
            <div className="ops-card p-5">
              <div className="ops-label">Snapshot</div>
              <div className="mt-2 text-sm font-medium">{data.definition?.name ?? '—'}</div>
              <Field label="Pricing" value={data.definition?.pricingProvider ?? '—'} />
              <Field
                className="mt-3"
                label="Fee"
                value={(
                  <>
                    {formatAmount(data.definition?.exchangeFeePct ?? 0)}
                    % +
                    {' '}
                    {formatAmount(data.definition?.fixedFee ?? 0)}
                  </>
                )}
              />
              <Field
                label="Limits"
                value={(
                  <>
                    {formatAmount(data.definition?.minAmount)}
                    {' '}
                    -
                    {' '}
                    {formatAmount(data.definition?.maxAmount)}
                  </>
                )}
              />
            </div>
          </div>

          <div className="mt-10">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Steps</h2>
              <div className="text-xs text-ops-muted">
                {data.steps.length}
                {' '}
                steps
              </div>
            </div>
            <div className="mt-4 space-y-4">
              {data.steps.length === 0 && (
                <OpsEmptyState>No steps recorded for this instance.</OpsEmptyState>
              )}
              {data.steps.map((step) => {
                const errorMessage = extractErrorMessage(step.error)
                const actionKey = `${step.status === 'FAILED' ? 'retry' : 'requeue'}-${step.id}`
                return (
                  <div className="ops-card p-5" key={step.id}>
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <OpsStatusBadge label={humanizeStatus(step.status)} tone={stepStatusTone[step.status]} />
                          <span className="text-xs uppercase tracking-wider text-ops-muted">
                            Step
                            {' '}
                            {step.stepOrder}
                          </span>
                        </div>
                        <div className="mt-2 text-lg font-semibold">{humanizeStatus(step.stepType)}</div>
                        <div className="mt-1 text-xs text-ops-muted">
                          Attempts
                          {' '}
                          {step.attempts}
                          {' '}
                          /
                          {' '}
                          {step.maxAttempts}
                        </div>
                        <div className="mt-2 text-xs text-ops-muted">
                          Started
                          {' '}
                          {formatDateTime(step.startedAt)}
                          {' '}
                          · Ended
                          {' '}
                          {formatDateTime(step.endedAt)}
                        </div>
                        {errorMessage && (
                          <div className="mt-2 text-xs text-rose-700">{errorMessage}</div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {step.status === 'FAILED' && (
                          <button
                            className="ops-btn-danger ops-btn-sm"
                            disabled={actionLoading === actionKey || !opsApiKey}
                            onClick={() => void handleAction(step, 'retry')}
                            type="button"
                          >
                            {actionLoading === actionKey ? 'Retrying...' : 'Retry Step'}
                          </button>
                        )}
                        {step.status === 'WAITING' && (
                          <button
                            className="ops-btn-neutral ops-btn-sm"
                            disabled={actionLoading === actionKey || !opsApiKey}
                            onClick={() => void handleAction(step, 'requeue')}
                            type="button"
                          >
                            {actionLoading === actionKey ? 'Requeuing...' : 'Requeue Step'}
                          </button>
                        )}
                        {step.status === 'RUNNING' && (
                          <button
                            className="ops-btn-danger ops-btn-sm"
                            disabled={actionLoading === `force-${step.id}` || !opsApiKey}
                            onClick={() => void handleForceReset(step)}
                            title="Re-queue a stuck RUNNING step. Risks double execution for money steps."
                            type="button"
                          >
                            {actionLoading === `force-${step.id}` ? 'Forcing...' : 'Force Reset ⚠'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                      <details className="rounded-xl border border-ops-border bg-white/70 p-3">
                        <summary className="cursor-pointer font-semibold">Input</summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ops-muted">{formatJson(step.input)}</pre>
                      </details>
                      <details className="rounded-xl border border-ops-border bg-white/70 p-3">
                        <summary className="cursor-pointer font-semibold">Output</summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ops-muted">{formatJson(step.output)}</pre>
                      </details>
                      <details className="rounded-xl border border-ops-border bg-white/70 p-3">
                        <summary className="cursor-pointer font-semibold">Correlation</summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-ops-muted">{formatJson(step.correlation)}</pre>
                      </details>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-10">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Signals</h2>
              <div className="text-xs text-ops-muted">
                {data.signals.length}
                {' '}
                events
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {data.signals.length === 0 && (
                <OpsEmptyState>No signals recorded for this instance.</OpsEmptyState>
              )}
              {data.signals.map(signal => (
                <div className="ops-card p-4 text-xs text-ops-muted" key={signal.id}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-semibold text-ops-text">{signal.eventType}</div>
                      <div className="text-[11px]">
                        Created
                        {' '}
                        {formatDateTime(signal.createdAt)}
                        {' '}
                        · Consumed
                        {' '}
                        {formatDateTime(signal.consumedAt)}
                      </div>
                    </div>
                    <div className="text-[11px]">
                      Step
                      {' '}
                      {signal.stepInstanceId ?? '—'}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <details className="rounded-lg border border-ops-border bg-white/70 p-2">
                      <summary className="cursor-pointer font-semibold">Correlation</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">{formatJson(signal.correlationKeys)}</pre>
                    </details>
                    <details className="rounded-lg border border-ops-border bg-white/70 p-2">
                      <summary className="cursor-pointer font-semibold">Payload</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px]">{formatJson(signal.payload)}</pre>
                    </details>
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

export default FlowOpsDetail
