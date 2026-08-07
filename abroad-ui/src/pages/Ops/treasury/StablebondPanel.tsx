import type { FormEvent } from 'react'

import { useState } from 'react'

import type {
  OpsStablebondExecutionResult,
  OpsStablebondResponse,
  OpsStablebondUnwind,
} from '../../../services/admin/treasuryTypes'

import {
  acquireStablebond,
  openStablebondTrustline,
  registerStablebondBasis,
  unwindStablebond,
} from '../../../services/admin/treasuryAdminApi'
import {
  formatAmount,
  formatDateTime,
  OpsBanner,
  OpsDialog,
  OpsEmptyState,
  OpsField,
  OpsStatusBadge,
  OpsTone,
} from '../shared'
import { isOpsMutationCancelledError, useOpsMutation } from '../shared/opsMutationContext'

type ExecutionEditor = {
  amount: string
  kind: 'ACQUIRE' | 'UNWIND'
}

type StablebondPanelProps = {
  /** True only for an operator holding treasury:manage. Actions are hidden otherwise. */
  canManage: boolean
  error: null | string
  loading: boolean
  onChanged: () => Promise<void> | void
  onRetry: () => void
  overview: null | OpsStablebondResponse
}

const BASIS_POINTS = 10_000

const EXECUTION_COPY = {
  ACQUIRE: {
    action: 'treasury.stablebond.acquire' as const,
    cta: 'Acquire',
    description: 'Spends treasury USDC on bond tokens, bounded by the configured slippage tolerance.',
    label: 'USDC to spend',
    title: 'Acquire Stablebond position',
  },
  UNWIND: {
    action: 'treasury.stablebond.unwind' as const,
    cta: 'Unwind',
    description: 'Sells bond tokens for USDC. The slippage bound goes on chain, so a book that moves rejects the fill.',
    label: 'USDC to raise',
    title: 'Unwind Stablebond position',
  },
}

const UNWIND_TONES: Record<string, OpsTone> = {
  AMBIGUOUS: 'danger',
  CONFIRMED: 'success',
  FAILED: 'danger',
  QUOTED: 'neutral',
  SUBMITTED: 'info',
}

/**
 * The Stablebond position panel.
 *
 * Deliberately shows the cost as prominently as the yield. A treasury console
 * that reports 12.76% accruing without reporting the spread paid to get out is
 * telling half a story, and the half it omits is the one that decides whether
 * the position was worth holding.
 */
export function StablebondPanel({
  canManage,
  error,
  loading,
  onChanged,
  onRetry,
  overview,
}: StablebondPanelProps) {
  const { requestMutation } = useOpsMutation()
  const [editor, setEditor] = useState<ExecutionEditor | null>(null)
  const [working, setWorking] = useState(false)
  const [actionError, setActionError] = useState<null | string>(null)
  const [lastResult, setLastResult] = useState<null | string>(null)

  const run = async (title: string, body: () => Promise<string>): Promise<void> => {
    setWorking(true)
    setActionError(null)
    setLastResult(null)
    try {
      setLastResult(await body())
      await onChanged()
    }
    catch (err) {
      // A cancelled confirmation is the operator changing their mind, not a
      // failure, and must not be reported as one.
      if (!isOpsMutationCancelledError(err)) {
        setActionError(err instanceof Error ? err.message : `${title} failed`)
      }
    }
    finally {
      setWorking(false)
    }
  }

  const openTrustline = () => void run('Open trustline', async () => {
    const result = await requestMutation({
      action: 'treasury.stablebond.open_trustline',
      execute: mutation => openStablebondTrustline(mutation),
      resourceLabel: overview?.position?.symbol ?? 'Stablebond',
      title: 'Open Stablebond trustline',
    })
    return `Trustline ${result.outcome.toLowerCase()}.`
  })

  const registerBasis = () => void run('Re-base position', async () => {
    await requestMutation({
      action: 'treasury.stablebond.register_basis',
      execute: mutation => registerStablebondBasis(mutation),
      resourceLabel: overview?.position?.symbol ?? 'Stablebond',
      title: 'Re-base Stablebond position',
    })
    return 'Cost basis re-registered from the current holding.'
  })

  const submitExecution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor) return
    const amount = Number(editor.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionError('Enter a positive USDC amount')
      return
    }
    const copy = EXECUTION_COPY[editor.kind]
    void run(copy.title, async () => {
      const result = await requestMutation<OpsStablebondExecutionResult>({
        action: copy.action,
        execute: mutation => (editor.kind === 'ACQUIRE'
          ? acquireStablebond(amount, mutation)
          : unwindStablebond(amount, mutation)),
        resourceLabel: `${amount} USDC`,
        title: copy.title,
      })
      setEditor(null)
      return describeExecution(result)
    })
  }

  return (
    <section aria-labelledby="stablebond-title" className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ops-text" id="stablebond-title">Yield position</h2>
          <p className="mt-1 text-sm text-ops-muted">
            Payout float held in an Etherfuse Stablebond, accruing until a customer needs it —
            with the spread it would cost to unwind right now. Acquired and unwound on
            Stellar&apos;s native DEX, which needs no issuer permission.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {overview?.position && (
            <span className="text-xs text-ops-muted">
              NAV as of
              {' '}
              {formatDateTime(overview.position.navObservedAt)}
            </span>
          )}
          {canManage && overview?.enabled && (
            <>
              <button className="ops-btn-neutral ops-btn-sm" disabled={working} onClick={openTrustline} type="button">
                Open trustline
              </button>
              <button className="ops-btn-neutral ops-btn-sm" disabled={working} onClick={registerBasis} type="button">
                Re-base
              </button>
              <button
                className="ops-btn-neutral ops-btn-sm"
                disabled={working}
                onClick={() => setEditor({ amount: '', kind: 'ACQUIRE' })}
                type="button"
              >
                Acquire
              </button>
              <button
                className="ops-btn-primary ops-btn-sm"
                disabled={working}
                onClick={() => setEditor({ amount: '', kind: 'UNWIND' })}
                type="button"
              >
                Unwind
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <OpsBanner className="mt-4" variant="error">{actionError}</OpsBanner>
      )}
      {lastResult && (
        <OpsBanner className="mt-4" variant="info">{lastResult}</OpsBanner>
      )}

      {error && (
        <OpsBanner className="mt-4" variant="error">
          Yield position refresh failed:
          {' '}
          {error}
          <button className="ml-2 font-semibold underline" onClick={onRetry} type="button">Retry this panel</button>
        </OpsBanner>
      )}

      {/*
        An enabled-but-unreadable position is an error, never a zero. Rendering
        it as "0 held" would tell an operator the treasury holds nothing when it
        may well hold a position we simply could not read.
      */}
      {overview?.enabled && overview.error && (
        <OpsBanner className="mt-4" variant="error">
          The position is enabled but could not be read (
          {overview.error}
          ). Treat its value as unknown, not as zero.
        </OpsBanner>
      )}

      {overview && !overview.enabled && (
        <OpsEmptyState className="mt-4">
          <span className="font-semibold text-ops-text">Yield position is off.</span>
          {' '}
          {overview.disabledReason ?? 'No Stablebond position is configured.'}
        </OpsEmptyState>
      )}

      {overview?.position && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <PositionCards overview={overview} />
          <UnwindTable unwinds={overview.recentUnwinds} />
        </div>
      )}

      {editor && (
        <OpsDialog
          description={EXECUTION_COPY[editor.kind].description}
          eyebrow="Treasury"
          onClose={() => setEditor(null)}
          title={EXECUTION_COPY[editor.kind].title}
        >
          <form className="space-y-4" onSubmit={submitExecution}>
            <OpsField
              hint={overview?.position
                ? `Bound ${overview.position.maxSlippageBps} bps against NAV. Cap ${formatAmount(overview.position.jitUnwindCapUsdc, 0)} USDC.`
                : undefined}
              label={EXECUTION_COPY[editor.kind].label}
            >
              <input
                className="ops-input"
                inputMode="decimal"
                min="0"
                onChange={event => setEditor(current => (current ? { ...current, amount: event.target.value } : current))}
                step="0.01"
                type="number"
                value={editor.amount}
              />
            </OpsField>
            <div className="flex justify-end gap-2">
              <button className="ops-btn-ghost" onClick={() => setEditor(null)} type="button">Cancel</button>
              <button className="ops-btn-primary" disabled={working} type="submit">
                {EXECUTION_COPY[editor.kind].cta}
              </button>
            </div>
          </form>
        </OpsDialog>
      )}
    </section>
  )
}

/**
 * An execution outcome in one line. Ambiguous and failed are outcomes, not
 * errors: the operator has to read the execution id and stop, not retry.
 */
function describeExecution(result: OpsStablebondExecutionResult): string {
  if (result.outcome === 'confirmed') {
    const received = result.receivedAmount === null ? 'an unmeasured amount' : formatAmount(result.receivedAmount, 4)
    const spread = result.spreadBps === null ? 'spread pending' : `${result.spreadBps} bps`
    return `Settled: received ${received} at ${spread}.`
  }
  if (result.outcome === 'ambiguous') {
    return `Ambiguous (${result.reason ?? 'unknown'}). Do NOT retry — reconcile execution ${result.executionId ?? 'unknown'} against the venue first.`
  }
  return `Not executed (${result.reason ?? 'unknown'}). Nothing moved.`
}

/** Basis points to a percentage string. 1276 bps reads as 12.76%. */
function formatPercent(basisPoints: number): string {
  return `${formatAmount((basisPoints / BASIS_POINTS) * 100, 2)}%`
}

function PositionCards({ overview }: { overview: OpsStablebondResponse }) {
  const position = overview.position
  if (!position) return null
  const { unwindable } = position

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-4">
      <div className="ops-card p-5">
        <div className="text-sm text-ops-muted">
          {position.symbol}
          {' '}
          held
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-ops-text">
          {formatAmount(position.heldTokens, 2)}
        </div>
        <div className="mt-2 text-xs text-ops-muted">
          {formatAmount(position.valueFiat, 2)}
          {' '}
          {position.fiatCurrency}
          {' · $'}
          {formatAmount(position.valueUsd, 2)}
        </div>
      </div>

      <div className="ops-card p-5">
        <div className="text-sm text-ops-muted">Accrued yield</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-ops-text">
          {formatAmount(position.accruedFiat, 2)}
          {' '}
          <span className="text-base font-normal text-ops-muted">{position.fiatCurrency}</span>
        </div>
        <div className="mt-2 text-xs text-ops-muted">
          {position.principalFiat === null
            ? 'No cost basis registered yet'
            : `on ${formatAmount(position.principalFiat, 2)} ${position.fiatCurrency} since ${formatDateTime(position.openedAt)}`}
        </div>
      </div>

      <div className="ops-card p-5">
        <div className="text-sm text-ops-muted">Rate</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-ops-text">
          {formatPercent(position.annualYieldBps)}
        </div>
        <div className="mt-2 text-xs text-ops-muted">
          {position.effectiveAnnualBps === null
            ? 'Realised rate available after an hour held'
            : `${formatPercent(position.effectiveAnnualBps)} realised so far`}
        </div>
      </div>

      {/*
        The number the whole thesis rests on: a position that cannot be unwound
        inside a payout window is not float, whatever it is worth on paper.
      */}
      <div className="ops-card p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-ops-muted">Unwind now</div>
          <OpsStatusBadge
            label={unwindable.feasible ? 'Feasible' : 'Refused'}
            tone={unwindable.feasible ? 'success' : 'danger'}
          />
        </div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-ops-text">
          {unwindable.spreadBps === null ? '—' : `${unwindable.spreadBps} bps`}
        </div>
        <div className="mt-2 text-xs text-ops-muted">
          {unwindable.feasible
            ? `cost to raise $${formatAmount(unwindable.testedUsdc, 0)} · bound ${position.maxSlippageBps} bps`
            : (unwindable.reason ?? 'unavailable')}
        </div>
      </div>
    </div>
  )
}

function UnwindTable({ unwinds }: { unwinds: OpsStablebondUnwind[] }) {
  if (unwinds.length === 0) {
    return (
      <OpsEmptyState className="mt-4">
        <span className="font-semibold text-ops-text">No unwinds yet.</span>
        {' '}
        Executions appear here with the quote they were taken at and the spread they actually paid.
      </OpsEmptyState>
    )
  }

  return (
    <div className="ops-card mt-4 overflow-x-auto p-0">
      <table className="min-w-full text-sm">
        <caption className="sr-only">Recent Stablebond unwind executions</caption>
        <thead className="border-b border-ops-border text-left text-xs uppercase text-ops-muted">
          <tr>
            <th className="px-4 py-3" scope="col">Quoted</th>
            <th className="px-4 py-3" scope="col">Direction</th>
            <th className="px-4 py-3" scope="col">Status</th>
            <th className="px-4 py-3 text-right" scope="col">Sent</th>
            <th className="px-4 py-3 text-right" scope="col">Quoted for</th>
            <th className="px-4 py-3 text-right" scope="col">Floor</th>
            <th className="px-4 py-3 text-right" scope="col">Received</th>
            <th className="px-4 py-3 text-right" scope="col">Spread</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ops-border">
          {unwinds.map(unwind => (
            <tr key={unwind.id}>
              <th className="px-4 py-3 font-normal text-ops-muted" scope="row">
                {formatDateTime(unwind.quotedAt)}
              </th>
              <td className="px-4 py-3">
                <OpsStatusBadge
                  label={unwind.direction}
                  tone={unwind.direction === 'ACQUIRE' ? 'info' : 'neutral'}
                />
              </td>
              <td className="px-4 py-3">
                <OpsStatusBadge label={unwind.status} tone={UNWIND_TONES[unwind.status] ?? 'neutral'} />
                {unwind.failureReason && (
                  <div className="mt-1 text-xs text-ops-muted">{unwind.failureReason}</div>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatAmount(unwind.sendAmount, 4)}
                {' '}
                <span className="text-xs text-ops-muted">{unwind.sendAsset}</span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{formatAmount(unwind.quotedReceive, 4)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatAmount(unwind.minReceive, 4)}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {unwind.receivedAmount === null ? '—' : formatAmount(unwind.receivedAmount, 4)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {unwind.spreadBps === null ? '—' : `${unwind.spreadBps} bps`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
