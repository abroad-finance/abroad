import type { FormEvent, KeyboardEvent, ReactNode } from 'react'

import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import type {
  OpsMutationAction,
  OpsMutationDetails,
  OpsMutationPolicy,
} from '../../../services/admin/opsMutationTypes'

import { useOpsSession } from '../../../services/admin/opsAuthStore'
import { getOpsMutationPolicy, stepUpOpsSession } from '../../../services/admin/opsIdentityApi'
import {
  classifyOpsTelemetryFailure,
  getOpsTelemetryViewport,
  recordOpsTaskEvent,
} from '../../../services/admin/opsTaskTelemetry'
import { cn } from '../../../shared/utils'
import { OpsBanner } from './OpsBanner'
import {
  OpsMutationCancelledError,
  OpsMutationContext,
  OpsMutationContextValue,
  OpsMutationRequest,
} from './opsMutationContext'

type PendingMutation = {
  action: OpsMutationAction
  cancel: () => void
  execute: (details: OpsMutationDetails) => Promise<void>
  expectedVersion?: number
  idempotencyKey: string
  requestedAt: number
  resourceLabel?: string
  title: string
  viewport: ReturnType<typeof getOpsTelemetryViewport>
}

const recordMutationCompletion = (
  mutation: Pick<PendingMutation, 'action' | 'requestedAt' | 'viewport'>,
  result: 'ABANDONED' | 'FAILED' | 'SUCCEEDED',
  failure?: unknown,
): void => {
  const durationMs = Math.min(60 * 60 * 1_000, Date.now() - mutation.requestedAt)
  recordOpsTaskEvent({
    action: 'COMPLETED',
    durationMs,
    metadata: {
      failureClass: result === 'FAILED' ? classifyOpsTelemetryFailure(failure) : undefined,
      viewport: mutation.viewport,
    },
    result,
    task: 'MUTATION',
  })
  if (mutation.action === 'incident.update') {
    recordOpsTaskEvent({
      action: 'COMPLETED',
      durationMs,
      metadata: {
        entryPoint: 'INCIDENT',
        failureClass: result === 'FAILED' ? classifyOpsTelemetryFailure(failure) : undefined,
        viewport: mutation.viewport,
      },
      result,
      task: 'INCIDENT_OWNERSHIP',
    })
  }
}

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type OpsMutationDialogProps = {
  mutation: PendingMutation
}

const OpsMutationDialog = ({ mutation }: OpsMutationDialogProps) => {
  const session = useOpsSession()
  const dialogRef = useRef<HTMLDivElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [operationStarted, setOperationStarted] = useState(false)
  const [policy, setPolicy] = useState<null | OpsMutationPolicy>(null)
  const [policyError, setPolicyError] = useState<null | string>(null)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const descriptionId = useId()
  const errorId = useId()
  const titleId = useId()

  useEffect(() => {
    let active = true
    setPolicy(null)
    setPolicyError(null)
    void getOpsMutationPolicy(mutation.action)
      .then((nextPolicy) => {
        if (active) setPolicy(nextPolicy)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setPolicyError(loadError instanceof Error ? loadError.message : 'Mutation policy is unavailable')
      })
    return () => {
      active = false
    }
  }, [mutation.action])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const frame = window.requestAnimationFrame(() => reasonRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      returnFocusRef.current?.focus()
    }
  }, [])

  const canMutate = useMemo(() => (
    policy ? Boolean(session?.permissions.includes(policy.permission)) : false
  ), [policy, session?.permissions])

  const stepUpIsCurrent = useMemo(() => {
    if (!session?.stepUpExpiresAt) return false
    return Date.parse(session.stepUpExpiresAt) > Date.now()
  }, [session?.stepUpExpiresAt])

  const close = (): void => {
    if (!submitting) mutation.cancel()
  }

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    }
    else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!policy || policyError || operationStarted) return
    const normalizedReason = reason.trim()
    if (!canMutate) {
      setError('Your current role does not permit this operation.')
      return
    }
    if (normalizedReason.length < 10) {
      setError('Explain the operational reason in at least 10 characters.')
      reasonRef.current?.focus()
      return
    }
    if (confirmation !== policy.confirmation) {
      setError(`Type “${policy.confirmation}” exactly to confirm.`)
      confirmationRef.current?.focus()
      return
    }
    if (policy.expectedVersion && mutation.expectedVersion === undefined) {
      setError('This item must be refreshed before it can be changed safely.')
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      if (policy.stepUpRequired && !stepUpIsCurrent) {
        await stepUpOpsSession()
      }
      setOperationStarted(true)
      await mutation.execute({
        confirmation: policy.confirmation,
        expectedVersion: mutation.expectedVersion,
        idempotencyKey: mutation.idempotencyKey,
        reason: normalizedReason,
        reference: reference.trim() || undefined,
      })
    }
    catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The operation could not be completed')
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      data-testid="ops-mutation-overlay"
    >
      <div
        aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-ops-border bg-white shadow-2xl sm:max-w-xl sm:rounded-3xl"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ops-border px-5 py-4 sm:px-6">
          <div>
            <div className="ops-eyebrow">Protected operation</div>
            <h2 className="mt-1 text-xl font-semibold text-ops-text" id={titleId}>
              {mutation.title}
            </h2>
            {mutation.resourceLabel && (
              <p className="mt-1 break-words text-sm text-ops-muted">{mutation.resourceLabel}</p>
            )}
          </div>
          <button
            aria-label="Cancel operation"
            className="ops-icon-btn shrink-0"
            disabled={submitting}
            onClick={close}
            type="button"
          >
            <X aria-hidden size={18} />
          </button>
        </div>

        <form className="space-y-5 px-5 py-5 sm:px-6" onSubmit={event => void submit(event)}>
          {policy
            ? (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" id={descriptionId}>
                  <div className="flex gap-3">
                    <AlertTriangle aria-hidden className="mt-0.5 shrink-0 text-amber-700" size={20} />
                    <div>
                      <div className="font-semibold text-amber-950">Impact</div>
                      <p className="mt-1 text-sm leading-6 text-amber-900">{policy.impact}</p>
                    </div>
                  </div>
                </div>
              )
            : (
                <div aria-live="polite" className="rounded-2xl border border-ops-border bg-ops-bg p-4 text-sm text-ops-muted" id={descriptionId} role="status">
                  Loading authorization policy…
                </div>
              )}

          {policyError && <OpsBanner variant="error">{policyError}</OpsBanner>}

          <div>
            <label className="ops-label" htmlFor={`${titleId}-reason`}>Operational reason</label>
            <textarea
              aria-describedby={`${titleId}-reason-hint`}
              aria-invalid={Boolean(error && reason.trim().length < 10)}
              className="ops-input min-h-28 resize-y"
              disabled={submitting || operationStarted}
              id={`${titleId}-reason`}
              maxLength={500}
              minLength={10}
              name="ops-mutation-reason"
              onChange={event => setReason(event.target.value)}
              placeholder="Why is this change necessary now?"
              ref={reasonRef}
              required
              value={reason}
            />
            <p className="mt-1.5 text-xs leading-5 text-ops-muted" id={`${titleId}-reason-hint`}>
              Recorded in the immutable audit trail. Do not include customer PII.
            </p>
          </div>

          <div>
            <label className="ops-label" htmlFor={`${titleId}-reference`}>
              Ticket or incident reference
              <span className="font-normal text-ops-muted">(optional)</span>
            </label>
            <input
              autoComplete="off"
              className="ops-input"
              disabled={submitting || operationStarted}
              id={`${titleId}-reference`}
              maxLength={120}
              name="ops-mutation-reference"
              onChange={event => setReference(event.target.value)}
              placeholder="INC-1234 or support case URL"
              value={reference}
            />
          </div>

          {policy && (
            <div>
              <label className="ops-label" htmlFor={`${titleId}-confirmation`}>
                Type
                {' '}
                <span className="font-mono text-ops-text">{policy.confirmation}</span>
                {' '}
                to confirm
              </label>
              <input
                autoCapitalize="characters"
                autoComplete="off"
                className="ops-input font-mono"
                disabled={submitting || operationStarted}
                id={`${titleId}-confirmation`}
                name="ops-mutation-confirmation"
                onChange={event => setConfirmation(event.target.value)}
                ref={confirmationRef}
                required
                spellCheck={false}
                value={confirmation}
              />
            </div>
          )}

          {error && (
            <div id={errorId}>
              <OpsBanner variant="error">
                {operationStarted
                  ? `${error} Close this dialog and verify the current state before requesting another attempt.`
                  : error}
              </OpsBanner>
            </div>
          )}

          {!canMutate && policy && (
            <OpsBanner variant="warning">
              This action requires the
              {' '}
              <span className="font-mono">{policy.permission}</span>
              {' '}
              permission.
            </OpsBanner>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-ops-border pt-5 sm:flex-row sm:justify-end">
            <button
              className="ops-btn-neutral"
              disabled={submitting}
              onClick={close}
              type="button"
            >
              Cancel
            </button>
            <button
              className={cn('ops-btn-danger', submitting && 'cursor-wait')}
              disabled={!policy || Boolean(policyError) || !canMutate || submitting || operationStarted}
              type="submit"
            >
              {policy?.stepUpRequired && !stepUpIsCurrent && <ShieldCheck aria-hidden size={18} />}
              {submitting
                ? 'Authorizing…'
                : policy?.stepUpRequired && !stepUpIsCurrent
                  ? 'Verify and execute'
                  : 'Execute operation'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

export const OpsMutationProvider = ({ children }: { children: ReactNode }) => {
  const [pending, setPending] = useState<null | PendingMutation>(null)
  const pendingRef = useRef(false)

  const requestMutation = useCallback(function requestMutation<TResult>(
    request: OpsMutationRequest<TResult>,
  ): Promise<TResult> {
    if (pendingRef.current) {
      return Promise.reject(new Error('Finish the current protected operation first'))
    }
    pendingRef.current = true
    const requestedAt = Date.now()
    const viewport = getOpsTelemetryViewport()
    recordOpsTaskEvent({
      action: 'REQUESTED',
      metadata: { viewport },
      result: 'SUCCEEDED',
      task: 'MUTATION',
    })
    if (request.action === 'incident.update') {
      recordOpsTaskEvent({
        action: 'REQUESTED',
        metadata: { entryPoint: 'INCIDENT', viewport },
        result: 'SUCCEEDED',
        task: 'INCIDENT_OWNERSHIP',
      })
    }
    return new Promise<TResult>((resolve, reject) => {
      const close = (): void => {
        pendingRef.current = false
        setPending(null)
      }
      setPending({
        action: request.action,
        cancel: () => {
          recordMutationCompletion({ action: request.action, requestedAt, viewport }, 'ABANDONED')
          close()
          reject(new OpsMutationCancelledError())
        },
        execute: async (details) => {
          try {
            const result = await request.execute(details)
            recordMutationCompletion({ action: request.action, requestedAt, viewport }, 'SUCCEEDED')
            close()
            resolve(result)
          }
          catch (executionError) {
            recordMutationCompletion(
              { action: request.action, requestedAt, viewport },
              'FAILED',
              executionError,
            )
            throw executionError
          }
        },
        expectedVersion: request.expectedVersion,
        idempotencyKey: crypto.randomUUID(),
        requestedAt,
        resourceLabel: request.resourceLabel,
        title: request.title,
        viewport,
      })
    })
  }, [])

  const value = useMemo<OpsMutationContextValue>(() => ({ requestMutation }), [requestMutation])

  return (
    <OpsMutationContext.Provider value={value}>
      {children}
      {pending && <OpsMutationDialog mutation={pending} />}
    </OpsMutationContext.Provider>
  )
}
