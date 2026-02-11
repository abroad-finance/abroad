import {
  useCallback, useEffect, useMemo, useState,
} from 'react'
import { Link, useParams } from 'react-router-dom'

import { getFlowInstance, requeueFlowStep, retryFlowStep } from '../../services/admin/flowAdminApi'
import {
  FlowInstanceDetail,
  FlowInstanceStatus,
  FlowStepInstance,
  FlowStepStatus,
} from '../../services/admin/flowTypes'
import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const flowStatusClasses: Record<FlowInstanceStatus, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  IN_PROGRESS: 'bg-sky-100 text-sky-800 border-sky-200',
  NOT_STARTED: 'bg-slate-100 text-slate-700 border-slate-200',
  WAITING: 'bg-amber-100 text-amber-800 border-amber-200',
}

const stepStatusClasses: Record<FlowStepStatus, string> = {
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  READY: 'bg-slate-100 text-slate-700 border-slate-200',
  RUNNING: 'bg-sky-100 text-sky-800 border-sky-200',
  SKIPPED: 'bg-slate-100 text-slate-600 border-slate-200',
  SUCCEEDED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  WAITING: 'bg-amber-100 text-amber-800 border-amber-200',
}

const formatDate = (value: null | string) => (value ? new Date(value).toLocaleString() : '—')

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

const FlowOpsDetail = () => {
  const { flowInstanceId } = useParams()
  const [data, setData] = useState<FlowInstanceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<null | string>(null)
  const [error, setError] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()

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
        await retryFlowStep(flowInstanceId, step.id)
      }
      else {
        await requeueFlowStep(flowInstanceId, step.id)
      }
      await load()
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    }
    finally {
      setActionLoading(null)
    }
  }, [
    flowInstanceId,
    load,
    opsApiKey,
  ])

  return (
    <div className="min-h-screen bg-[#F7F3EC] text-[#1A1A1A]">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-6xl mx-auto px-6 py-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-3 text-sm">
                <Link className="text-[#1B4D48] hover:text-[#356E6A]" to="/ops/flows">← Back to flows</Link>
                <Link className="text-[#1B4D48] hover:text-[#356E6A]" to="/ops/flows/definitions">Edit definitions</Link>
                <Link className="text-[#1B4D48] hover:text-[#356E6A]" to="/ops/partners">Partners & API keys</Link>
              </div>
              <div className="mt-3 text-sm uppercase tracking-[0.3em] text-[#356E6A]">Flow Instance</div>
              <h1 className="text-3xl md:text-4xl font-semibold">{headerDefinition}</h1>
              <p className="text-xs text-[#6B7280] mt-2">{flowInstanceId}</p>
            </div>
            {data && (
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${flowStatusClasses[data.status]}`}>
                  {data.status}
                </span>
                <div className="text-xs text-[#6B7280]">
                  Updated
                  {formatDate(data.updatedAt)}
                </div>
              </div>
            )}
          </div>

          <OpsApiKeyPanel />

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!opsApiKey && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to load flow details.
            </div>
          )}

          {loading && opsApiKey && (
            <div className="mt-6 text-sm text-[#6B7280]">Loading flow instance...</div>
          )}

          {data && opsApiKey && (
            <>
              <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                  <div className="text-xs uppercase tracking-wider text-[#6B7280]">Transaction</div>
                  <div className="mt-2 text-sm font-medium">{data.transaction?.id ?? '—'}</div>
                  <div className="mt-1 text-xs text-[#6B7280]">
                    Status:
                    {data.transaction?.status ?? '—'}
                  </div>
                  <div className="mt-3 text-xs text-[#6B7280]">
                    External ID:
                    {data.transaction?.externalId ?? '—'}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    On-chain:
                    {data.transaction?.onChainId ?? '—'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                  <div className="text-xs uppercase tracking-wider text-[#6B7280]">Amounts</div>
                  <div className="mt-2 text-sm font-medium">
                    Source:
                    {data.transaction?.quote.sourceAmount ?? '—'}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    Target:
                    {data.transaction?.quote.targetAmount ?? '—'}
                    {' '}
                    {data.transaction?.quote.targetCurrency ?? ''}
                  </div>
                  <div className="mt-3 text-xs text-[#6B7280]">
                    Network:
                    {data.transaction?.quote.network ?? '—'}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    Payment:
                    {data.transaction?.paymentMethod ?? '—'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                  <div className="text-xs uppercase tracking-wider text-[#6B7280]">Snapshot</div>
                  <div className="mt-2 text-sm font-medium">{data.definition?.name ?? '—'}</div>
                  <div className="text-xs text-[#6B7280]">
                    Pricing:
                    {data.definition?.pricingProvider ?? '—'}
                  </div>
                  <div className="mt-3 text-xs text-[#6B7280]">
                    Fee:
                    {data.definition?.exchangeFeePct ?? 0}
                    % +
                    {data.definition?.fixedFee ?? 0}
                  </div>
                  <div className="text-xs text-[#6B7280]">
                    Limits:
                    {data.definition?.minAmount ?? '—'}
                    {' '}
                    -
                    {data.definition?.maxAmount ?? '—'}
                  </div>
                </div>
              </div>

              <div className="mt-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Steps</h2>
                  <div className="text-xs text-[#6B7280]">
                    {data.steps.length}
                    {' '}
                    steps
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  {data.steps.map((step) => {
                    const errorMessage = extractErrorMessage(step.error)
                    const actionKey = `${step.status === 'FAILED' ? 'retry' : 'requeue'}-${step.id}`
                    return (
                      <div
                        className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_15px_45px_-35px_rgba(15,23,42,0.45)]"
                        key={step.id}
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="flex items-center gap-3">
                              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${stepStatusClasses[step.status]}`}>
                                {step.status}
                              </span>
                              <span className="text-xs uppercase tracking-wider text-[#64748B]">
                                Step
                                {step.stepOrder}
                              </span>
                            </div>
                            <div className="mt-2 text-lg font-semibold">{step.stepType}</div>
                            <div className="mt-1 text-xs text-[#6B7280]">
                              Attempts
                              {step.attempts}
                              {' '}
                              /
                              {step.maxAttempts}
                            </div>
                            <div className="mt-2 text-xs text-[#6B7280]">
                              Started
                              {formatDate(step.startedAt)}
                              {' '}
                              · Ended
                              {formatDate(step.endedAt)}
                            </div>
                            {errorMessage && (
                              <div className="mt-2 text-xs text-rose-700">{errorMessage}</div>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {step.status === 'FAILED' && (
                              <button
                                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                disabled={actionLoading === actionKey || !opsApiKey}
                                onClick={() => void handleAction(step, 'retry')}
                                type="button"
                              >
                                {actionLoading === actionKey ? 'Retrying...' : 'Retry Step'}
                              </button>
                            )}
                            {step.status === 'WAITING' && (
                              <button
                                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                                disabled={actionLoading === actionKey || !opsApiKey}
                                onClick={() => void handleAction(step, 'requeue')}
                                type="button"
                              >
                                {actionLoading === actionKey ? 'Requeuing...' : 'Requeue Step'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                          <details className="rounded-xl border border-[#E5E7EB] bg-white/70 p-3">
                            <summary className="cursor-pointer font-semibold">Input</summary>
                            <pre className="mt-2 whitespace-pre-wrap text-[11px] text-[#4B5563]">{formatJson(step.input)}</pre>
                          </details>
                          <details className="rounded-xl border border-[#E5E7EB] bg-white/70 p-3">
                            <summary className="cursor-pointer font-semibold">Output</summary>
                            <pre className="mt-2 whitespace-pre-wrap text-[11px] text-[#4B5563]">{formatJson(step.output)}</pre>
                          </details>
                          <details className="rounded-xl border border-[#E5E7EB] bg-white/70 p-3">
                            <summary className="cursor-pointer font-semibold">Correlation</summary>
                            <pre className="mt-2 whitespace-pre-wrap text-[11px] text-[#4B5563]">{formatJson(step.correlation)}</pre>
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
                  <div className="text-xs text-[#6B7280]">
                    {data.signals.length}
                    {' '}
                    events
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {data.signals.length === 0 && (
                    <div className="rounded-xl border border-dashed border-[#C6C6C6] bg-white/70 px-6 py-8 text-center text-sm text-[#6B7280]">
                      No signals recorded for this instance.
                    </div>
                  )}
                  {data.signals.map(signal => (
                    <div
                      className="rounded-xl border border-white/70 bg-white/80 p-4 text-xs text-[#4B5563]"
                      key={signal.id}
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold text-[#1F2937]">{signal.eventType}</div>
                          <div className="text-[11px]">
                            Created
                            {formatDate(signal.createdAt)}
                            {' '}
                            · Consumed
                            {formatDate(signal.consumedAt)}
                          </div>
                        </div>
                        <div className="text-[11px]">
                          Step
                          {signal.stepInstanceId ?? '—'}
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <details className="rounded-lg border border-[#E5E7EB] bg-white/70 p-2">
                          <summary className="cursor-pointer font-semibold">Correlation</summary>
                          <pre className="mt-2 whitespace-pre-wrap text-[11px]">{formatJson(signal.correlationKeys)}</pre>
                        </details>
                        <details className="rounded-lg border border-[#E5E7EB] bg-white/70 p-2">
                          <summary className="cursor-pointer font-semibold">Payload</summary>
                          <pre className="mt-2 whitespace-pre-wrap text-[11px]">{formatJson(signal.payload)}</pre>
                        </details>
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

export default FlowOpsDetail
