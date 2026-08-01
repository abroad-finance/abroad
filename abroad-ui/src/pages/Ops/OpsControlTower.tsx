import type { LucideIcon } from 'lucide-react'

import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  Workflow,
} from 'lucide-react'
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { Link } from 'react-router-dom'

import type { FlowInstanceStatus } from '../../services/admin/flowTypes'
import type {
  OpsOverviewActivityPoint,
  OpsOverviewActivitySummary,
  OpsOverviewFlowStatusCount,
  OpsOverviewPartner,
  OpsOverviewRange,
  OpsOverviewResponse,
  OpsOverviewSeriesUnit,
} from '../../services/admin/overviewTypes'
import type { TransactionStatus } from '../../services/admin/transactionAdminTypes'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { getOpsOverview } from '../../services/admin/overviewAdminApi'
import { cn } from '../../shared/utils'
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  UtilizationMeter,
} from './shared'

const ACTIVITY_COLORS = {
  completed: '#1B4D48',
  expired: '#A8A29E',
  failed: '#BE123C',
  open: '#D97706',
}

const RANGE_OPTIONS: { label: string, value: OpsOverviewRange }[] = [
  { label: '24h', value: '24h' },
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
]

const RANGE_LABELS: Record<OpsOverviewRange, string> = {
  '7d': '7 days',
  '24h': '24 hours',
  '30d': '30 days',
}

const FLOW_STATUS_META: Record<FlowInstanceStatus, { color: string, label: string, text: string }> = {
  COMPLETED: { color: '#059669', label: 'Completed', text: 'text-emerald-700' },
  FAILED: { color: '#E11D48', label: 'Failed', text: 'text-rose-700' },
  IN_PROGRESS: { color: '#4F46E5', label: 'In progress', text: 'text-indigo-700' },
  NOT_STARTED: { color: '#A8A29E', label: 'Not started', text: 'text-stone-600' },
  WAITING: { color: '#F59E0B', label: 'Waiting', text: 'text-amber-700' },
}

const STATUS_GROUPS: { color: string, label: string, statuses: TransactionStatus[] }[] = [
  { color: ACTIVITY_COLORS.completed, label: 'Completed', statuses: ['PAYMENT_COMPLETED'] },
  { color: ACTIVITY_COLORS.open, label: 'Open', statuses: ['AWAITING_PAYMENT', 'PROCESSING_PAYMENT'] },
  { color: ACTIVITY_COLORS.failed, label: 'Failed', statuses: ['PAYMENT_FAILED', 'WRONG_AMOUNT'] },
  { color: ACTIVITY_COLORS.expired, label: 'Expired', statuses: ['PAYMENT_EXPIRED'] },
]

type ActivityChartProps = {
  series: OpsOverviewActivityPoint[]
  unit: OpsOverviewSeriesUnit
}

type ActivityStack = {
  color: string
  height: number
  key: string
  value: number
  y: number
}

type Delta = {
  direction: 'down' | 'flat' | 'up'
  label: string
}

type OutcomeSegment = {
  color: string
  count: number
  label: string
}

type QuickLinkProps = {
  description: string
  icon: LucideIcon
  label: string
  to: string
}

const CHART = {
  height: 220,
  paddingBottom: 28,
  paddingLeft: 36,
  paddingRight: 10,
  paddingTop: 12,
  width: 720,
}

const compactNumber = (value: number): string => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
}).format(value)

const countStatus = (
  summary: OpsOverviewActivitySummary,
  status: TransactionStatus,
): number => summary.statusCounts.find(entry => entry.status === status)?.count ?? 0

const formatBucket = (value: string, unit: OpsOverviewSeriesUnit): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', unit === 'HOUR'
    ? { hour: 'numeric' }
    : { day: 'numeric', month: 'short' }).format(date)
}

const formatElapsed = (from: null | string, to: string): string => {
  if (!from) return 'None waiting'
  const fromTime = new Date(from).getTime()
  const toTime = new Date(to).getTime()
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime) return 'Just now'
  const minutes = Math.floor((toTime - fromTime) / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const readDelta = (current: number, previous: number): Delta => {
  if (current === previous) return { direction: 'flat', label: 'No change' }
  if (previous === 0) return { direction: 'up', label: 'New activity' }
  const percent = Math.abs(((current - previous) / previous) * 100)
  return {
    direction: current > previous ? 'up' : 'down',
    label: `${percent.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`,
  }
}

const buildOutcomeSegments = (summary: OpsOverviewActivitySummary): OutcomeSegment[] => (
  STATUS_GROUPS.map(group => ({
    color: group.color,
    count: group.statuses.reduce((sum, status) => sum + countStatus(summary, status), 0),
    label: group.label,
  }))
)

const buildStacks = (
  point: OpsOverviewActivityPoint,
  maxValue: number,
  plotBottom: number,
  plotHeight: number,
): ActivityStack[] => {
  const values = [
    { color: ACTIVITY_COLORS.completed, key: 'completed', value: point.completedTransactions },
    { color: ACTIVITY_COLORS.open, key: 'open', value: point.openTransactions },
    { color: ACTIVITY_COLORS.failed, key: 'failed', value: point.failedTransactions },
    { color: ACTIVITY_COLORS.expired, key: 'expired', value: point.expiredTransactions },
  ]
  let cursor = plotBottom
  return values.map((entry) => {
    const height = maxValue > 0 ? (entry.value / maxValue) * plotHeight : 0
    cursor -= height
    return { ...entry, height, y: cursor }
  })
}

const DeltaBadge = ({ delta }: { delta: Delta }) => {
  const Icon = delta.direction === 'up' ? TrendingUp : delta.direction === 'down' ? TrendingDown : Minus
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-ops-border bg-stone-50 px-2 py-1 text-xs font-medium text-ops-muted">
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {delta.label}
    </span>
  )
}

const OutcomeRibbon = ({ summary }: { summary: OpsOverviewActivitySummary }) => {
  const segments = buildOutcomeSegments(summary)
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  const label = total === 0
    ? 'Transaction outcomes: no transactions in this window'
    : `Transaction outcomes: ${segments.map(segment => `${segment.count} ${segment.label.toLowerCase()}`).join(', ')}`
  let offset = 0

  return (
    <div>
      <svg
        aria-label={label}
        className="h-4 w-full overflow-hidden rounded-full"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 12"
      >
        <rect fill="#E7E5E4" height="12" rx="6" width="100" />
        {total > 0 && segments.map((segment) => {
          const width = (segment.count / total) * 100
          const x = offset
          offset += width
          return (
            <rect
              data-outcome={segment.label.toLowerCase()}
              fill={segment.color}
              height="12"
              key={segment.label}
              width={width}
              x={x}
            />
          )
        })}
      </svg>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {segments.map(segment => (
          <div className="flex min-w-0 items-center gap-2" key={segment.label}>
            <svg aria-hidden className="h-2.5 w-2.5 shrink-0" viewBox="0 0 10 10">
              <circle cx="5" cy="5" fill={segment.color} r="5" />
            </svg>
            <span className="truncate text-xs text-ops-muted">{segment.label}</span>
            <span className="ml-auto text-xs font-semibold tabular-nums text-ops-text">
              {segment.count.toLocaleString('en-US')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ActivityChart = ({ series, unit }: ActivityChartProps) => {
  const maxValue = Math.max(0, ...series.map(point => point.totalTransactions))
  if (maxValue === 0) {
    return <OpsEmptyState className="mt-5 py-10">No transaction activity in this window.</OpsEmptyState>
  }

  const plotWidth = CHART.width - CHART.paddingLeft - CHART.paddingRight
  const plotHeight = CHART.height - CHART.paddingTop - CHART.paddingBottom
  const plotBottom = CHART.paddingTop + plotHeight
  const step = plotWidth / series.length
  const barWidth = Math.max(3, Math.min(18, step * 0.64))
  const labelIndexes = new Set([
    0,
    Math.floor((series.length - 1) / 2),
    series.length - 1,
  ])
  const ticks = [
    0,
    Math.ceil(maxValue / 2),
    maxValue,
  ]

  return (
    <div className="mt-4">
      <svg
        aria-label={`Transaction activity chart with ${series.reduce((sum, point) => sum + point.totalTransactions, 0)} transactions`}
        className="w-full"
        role="img"
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      >
        {ticks.map((tick) => {
          const y = plotBottom - (tick / maxValue) * plotHeight
          return (
            <g key={tick}>
              <line
                stroke={tick === 0 ? '#C6C1B7' : '#E7E5E4'}
                strokeDasharray={tick === 0 ? undefined : '3 5'}
                x1={CHART.paddingLeft}
                x2={CHART.width - CHART.paddingRight}
                y1={y}
                y2={y}
              />
              <text fill="#78716C" fontSize="10" textAnchor="end" x={CHART.paddingLeft - 7} y={y + 3}>
                {compactNumber(tick)}
              </text>
            </g>
          )
        })}
        {series.map((point, index) => {
          const x = CHART.paddingLeft + step * index + (step - barWidth) / 2
          return (
            <g key={point.at}>
              {buildStacks(point, maxValue, plotBottom, plotHeight).map(stack => (
                <rect
                  fill={stack.color}
                  height={stack.height}
                  key={stack.key}
                  rx={stack.key === 'expired' ? 1.5 : 0}
                  width={barWidth}
                  x={x}
                  y={stack.y}
                />
              ))}
              {labelIndexes.has(index) && (
                <text
                  fill="#78716C"
                  fontSize="10"
                  textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
                  x={index === 0 ? CHART.paddingLeft : index === series.length - 1 ? CHART.width - CHART.paddingRight : x + barWidth / 2}
                  y={CHART.height - 7}
                >
                  {formatBucket(point.at, unit)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <ul className="sr-only">
        {series.map(point => (
          <li key={point.at}>
            {formatBucket(point.at, unit)}
            {': '}
            {point.completedTransactions}
            {' completed, '}
            {point.openTransactions}
            {' open, '}
            {point.failedTransactions}
            {' failed, and '}
            {point.expiredTransactions}
            {' expired.'}
          </li>
        ))}
      </ul>
    </div>
  )
}

const VolumeList = ({ label, volumes }: {
  label: string
  volumes: { amount: number, currency: string }[]
}) => (
  <div>
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ops-label">{label}</div>
    <div className="mt-1 flex flex-wrap gap-1.5">
      {volumes.length === 0
        ? <span className="text-sm text-ops-muted">—</span>
        : volumes.map(volume => (
            <span
              className="rounded-lg border border-ops-border bg-stone-50 px-2 py-1 text-xs font-semibold tabular-nums text-ops-text"
              key={volume.currency}
            >
              {formatAmount(volume.amount)}
              {' '}
              {volume.currency}
            </span>
          ))}
    </div>
  </div>
)

const PartnerRail = ({ maximum, partner, rank }: {
  maximum: number
  partner: OpsOverviewPartner
  rank: number
}) => {
  const width = maximum > 0 ? Math.min(100, Math.max(0, (partner.stablecoinAmount / maximum) * 100)) : 0
  const sourceBreakdown = partner.sourceVolume
    .map(volume => `${formatAmount(volume.amount)} ${volume.currency}`)
    .join(', ')
  return (
    <li className="border-t border-ops-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-ops-border bg-stone-50 text-xs font-bold tabular-nums text-ops-muted">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 truncate text-sm font-semibold text-ops-text">{partner.name}</span>
            <span className="text-sm font-semibold tabular-nums text-ops-text">
              {formatAmount(partner.stablecoinAmount)}
              {' '}
              <span className="text-[10px] uppercase tracking-wide text-ops-label">USD stables</span>
            </span>
          </div>
          <svg
            aria-label={`${partner.name}: rank ${rank}, ${formatAmount(partner.stablecoinAmount)} USD stablecoins${sourceBreakdown ? `; ${sourceBreakdown}` : ''}`}
            className="mt-2 h-2 w-full overflow-hidden rounded-full"
            preserveAspectRatio="none"
            role="img"
            viewBox="0 0 100 8"
          >
            <rect fill="#E7E5E4" height="8" rx="4" width="100" />
            <rect data-partner-volume fill="#4A3AA7" height="8" rx="4" width={width} />
          </svg>
          <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-ops-muted">
            <span>{sourceBreakdown || 'No completed volume'}</span>
            <span className="tabular-nums">
              {partner.completedTransactions.toLocaleString('en-US')}
              {' / '}
              {partner.totalTransactions.toLocaleString('en-US')}
              {' completed'}
            </span>
          </div>
        </div>
      </div>
    </li>
  )
}

const ExecutionRow = ({ entry, total }: { entry: OpsOverviewFlowStatusCount, total: number }) => {
  const meta = FLOW_STATUS_META[entry.status]
  const width = total > 0 ? Math.min(100, Math.max(0, (entry.count / total) * 100)) : 0
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={cn('font-medium', meta.text)}>{meta.label}</span>
        <span className="font-semibold tabular-nums text-ops-text">{entry.count.toLocaleString('en-US')}</span>
      </div>
      <svg aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" preserveAspectRatio="none" viewBox="0 0 100 6">
        <rect fill="#F5F5F4" height="6" rx="3" width="100" />
        <rect fill={meta.color} height="6" rx="3" width={width} />
      </svg>
    </div>
  )
}

const QuickLink = ({
  description,
  icon: Icon,
  label,
  to,
}: QuickLinkProps) => (
  <Link
    className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-brand/50"
    to={to}
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ops-brand/10 text-ops-brand">
      <Icon aria-hidden className="h-4 w-4" />
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-ops-text">{label}</span>
      <span className="block truncate text-xs text-ops-muted">{description}</span>
    </span>
    <ArrowRight aria-hidden className="ml-auto h-4 w-4 shrink-0 text-ops-muted transition-transform group-hover:translate-x-0.5" />
  </Link>
)

const OpsControlTower = () => {
  const opsApiKey = useOpsApiKey()
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(false)
  const [overview, setOverview] = useState<null | OpsOverviewResponse>(null)
  const [range, setRange] = useState<OpsOverviewRange>('24h')
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current
    if (!opsApiKey) {
      setError(null)
      setLoading(false)
      setOverview(null)
      return
    }

    setError(null)
    setLoading(true)
    try {
      const response = await getOpsOverview(range)
      if (requestId === requestSequence.current) setOverview(response)
    }
    catch (loadError) {
      if (requestId === requestSequence.current) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load the operations overview')
      }
    }
    finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }, [opsApiKey, range])

  useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load])

  const activityDelta = useMemo(() => overview
    ? readDelta(overview.activity.current.totalTransactions, overview.activity.previous.totalTransactions)
    : null, [overview])
  const outcomes = overview ? buildOutcomeSegments(overview.activity.current) : []
  const failedTransactions = outcomes.find(segment => segment.label === 'Failed')?.count ?? 0
  const openTransactions = outcomes.find(segment => segment.label === 'Open')?.count ?? 0
  const waitingFlows = overview?.execution.statusCounts.find(entry => entry.status === 'WAITING')?.count ?? 0
  const failedFlows = overview?.execution.statusCounts.find(entry => entry.status === 'FAILED')?.count ?? 0
  const partnerMaximum = Math.max(0, ...(overview?.partners.top.map(partner => partner.stablecoinAmount) ?? []))

  return (
    <OpsPageShell
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <div aria-label="Overview range" className="flex rounded-xl border border-ops-border bg-white/70 p-1" role="group">
            {RANGE_OPTIONS.map(option => (
              <button
                aria-pressed={range === option.value}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-brand/50',
                  range === option.value ? 'bg-ops-brand text-white' : 'text-ops-muted hover:bg-white hover:text-ops-text',
                )}
                key={option.value}
                onClick={() => setRange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="ops-btn-ghost"
            disabled={!opsApiKey || loading}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw aria-hidden className={cn('h-4 w-4', loading && 'animate-spin')} />
            {loading && overview ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      )}
      error={error}
      eyebrow="Operations"
      keyRequiredMessage="Ops API key required to load the Control Tower."
      subtitle="A live operating picture of payment outcomes, execution queues, partner concentration, and liquidity posture."
      title="Control Tower"
      width="full"
    >
      {loading && opsApiKey && !overview && (
        <OpsLoading className="mt-8" label="Assembling the operations overview…" />
      )}

      {overview && (
        <div className="mt-8 min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ops-muted">
            <span>
              Rolling
              {' '}
              {RANGE_LABELS[overview.window.range]}
              {' · compared with the preceding period'}
            </span>
            <span className="tabular-nums">
              Updated
              {' '}
              {formatDateTime(overview.generatedAt)}
            </span>
          </div>

          <section aria-labelledby="outcomes-heading" className="ops-card overflow-hidden backdrop-blur">
            <h2 className="sr-only" id="outcomes-heading">Transaction outcomes</h2>
            <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-6">
              <div className="min-w-0">
                <div className="ops-label">Current window</div>
                <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
                  <div className="text-4xl font-semibold tabular-nums text-ops-text">
                    {overview.activity.current.totalTransactions.toLocaleString('en-US')}
                  </div>
                  <span className="pb-1 text-sm text-ops-muted">transactions</span>
                  {activityDelta && <span className="pb-0.5"><DeltaBadge delta={activityDelta} /></span>}
                </div>
                <p className="mt-1 text-xs text-ops-muted">
                  Previous period:
                  {' '}
                  {overview.activity.previous.totalTransactions.toLocaleString('en-US')}
                </p>
              </div>
              <div className="border-t border-ops-border pt-4 md:min-w-44 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                <div className="ops-label">Terminal success</div>
                <div className="mt-2 text-3xl font-semibold tabular-nums text-ops-text">
                  {overview.activity.current.successRatePct === null
                    ? '—'
                    : `${overview.activity.current.successRatePct.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`}
                </div>
                <p className="mt-1 text-xs text-ops-muted">Completed ÷ terminal outcomes</p>
              </div>
            </div>
            <div className="border-t border-ops-border px-5 py-5 md:px-6">
              <OutcomeRibbon summary={overview.activity.current} />
            </div>
            <div className="grid gap-4 border-t border-ops-border bg-stone-50/60 px-5 py-4 sm:grid-cols-2 md:px-6">
              <VolumeList label="Completed source volume" volumes={overview.activity.current.sourceVolume} />
              <VolumeList label="Completed payout volume" volumes={overview.activity.current.payoutVolume} />
            </div>
          </section>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <section aria-labelledby="activity-heading" className="ops-card min-w-0 p-5 backdrop-blur md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="ops-label">Business activity</div>
                  <h2 className="mt-1 text-xl font-semibold text-ops-text" id="activity-heading">Outcome cadence</h2>
                  <p className="mt-1 text-xs text-ops-muted">Every bucket is stacked by its final or current state.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-ops-muted">
                  {STATUS_GROUPS.map(group => (
                    <span className="flex items-center gap-1.5" key={group.label}>
                      <svg aria-hidden className="h-2 w-2" viewBox="0 0 8 8">
                        <circle cx="4" cy="4" fill={group.color} r="4" />
                      </svg>
                      {group.label}
                    </span>
                  ))}
                </div>
              </div>
              <ActivityChart series={overview.activity.series} unit={overview.activity.seriesUnit} />
            </section>

            <section aria-labelledby="execution-heading" className="ops-card min-w-0 p-5 backdrop-blur md:p-6">
              <div className="ops-label">Execution ledger</div>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <h2 className="text-xl font-semibold text-ops-text" id="execution-heading">Flow state</h2>
                <span className="text-sm font-semibold tabular-nums text-ops-text">
                  {overview.execution.totalFlows.toLocaleString('en-US')}
                  {' total'}
                </span>
              </div>
              <div className="mt-5 space-y-3.5">
                {overview.execution.statusCounts.map(entry => (
                  <ExecutionRow entry={entry} key={entry.status} total={overview.execution.totalFlows} />
                ))}
              </div>
              <div className={cn(
                'mt-5 rounded-xl border px-4 py-3',
                waitingFlows > 0 || failedFlows > 0
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-emerald-200 bg-emerald-50',
              )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-ops-text">Oldest waiting flow</div>
                    <div className="mt-1 text-2xl font-semibold tabular-nums text-ops-text">
                      {formatElapsed(overview.execution.oldestWaitingAt, overview.generatedAt)}
                    </div>
                  </div>
                  <div className="text-right text-xs text-ops-muted">
                    <div>
                      {waitingFlows.toLocaleString('en-US')}
                      {' waiting'}
                    </div>
                    <div>
                      {failedFlows.toLocaleString('en-US')}
                      {' failed'}
                    </div>
                  </div>
                </div>
              </div>
              <Link className="ops-btn-ghost ops-btn-sm mt-5 w-full" to="/ops/flows">
                Inspect flows
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </section>
          </div>

          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <section aria-labelledby="partners-heading" className="ops-card min-w-0 p-5 backdrop-blur md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="ops-label">Partner concentration</div>
                  <h2 className="mt-1 text-xl font-semibold text-ops-text" id="partners-heading">Top completed volume</h2>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums text-ops-text">
                    {overview.partners.activePartners.toLocaleString('en-US')}
                    {' / '}
                    {overview.partners.totalPartners.toLocaleString('en-US')}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-ops-label">active partners</div>
                </div>
              </div>
              {overview.partners.top.length === 0
                ? <OpsEmptyState className="mt-5 py-10">No partner activity in this window.</OpsEmptyState>
                : (
                    <ol aria-label="Partners ranked by completed volume" className="mt-5">
                      {overview.partners.top.map((partner, index) => (
                        <PartnerRail
                          key={partner.id}
                          maximum={partnerMaximum}
                          partner={partner}
                          rank={index + 1}
                        />
                      ))}
                    </ol>
                  )}
              <Link className="ops-btn-ghost ops-btn-sm mt-5 w-full" to="/ops/partners">
                Open partner directory
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </Link>
            </section>

            <section aria-labelledby="liquidity-heading" className="ops-card min-w-0 overflow-hidden backdrop-blur">
              <div className="p-5 md:p-6">
                <div className="ops-label">Liquidity posture</div>
                <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-ops-text" id="liquidity-heading">Treasury & bridge</h2>
                    <p className="mt-1 text-xs text-ops-muted">Indicative USD value and settlement pressure.</p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold tabular-nums text-ops-text">
                      {formatMoney(overview.treasury.totalUsd, 'USD')}
                    </div>
                    <div className={cn(
                      'mt-1 text-xs font-medium',
                      overview.treasury.totalUsdIsPartial ? 'text-amber-700' : 'text-emerald-700',
                    )}
                    >
                      {overview.treasury.totalUsdIsPartial ? 'Partial valuation' : 'All venues reporting'}
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-ops-border bg-stone-50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-wide text-ops-label">Venues</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-ops-text">
                      {overview.treasury.venues.reporting}
                      {' / '}
                      {overview.treasury.venues.total}
                    </div>
                    <div className="text-xs text-ops-muted">reporting</div>
                  </div>
                  <div className="rounded-xl border border-ops-border bg-stone-50 px-3 py-3">
                    <div className="text-[10px] uppercase tracking-wide text-ops-label">Bridge queue</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-ops-text">
                      {overview.bridge.outstandingLegs.count.toLocaleString('en-US')}
                    </div>
                    <div className="text-xs tabular-nums text-ops-muted">
                      {formatAmount(overview.bridge.outstandingLegs.amount)}
                      {' USDC'}
                    </div>
                  </div>
                  <div className={cn(
                    'rounded-xl border px-3 py-3',
                    overview.bridge.failedLegs.count > 0 ? 'border-rose-200 bg-rose-50' : 'border-ops-border bg-stone-50',
                  )}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-ops-label">Failed legs</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-ops-text">
                      {overview.bridge.failedLegs.count.toLocaleString('en-US')}
                    </div>
                    <div className="text-xs tabular-nums text-ops-muted">
                      {formatAmount(overview.bridge.failedLegs.amount)}
                      {' USDC'}
                    </div>
                  </div>
                </div>
                {overview.bridge.float.enabled
                  ? (
                      <div className="mt-5 rounded-xl border border-ops-border bg-white px-4 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                          <div>
                            <div className="font-semibold text-ops-text">Bridge float</div>
                            <div className="mt-1 text-xs text-ops-muted">
                              Available:
                              {' '}
                              {formatMoney(overview.bridge.float.available, 'USDC')}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold tabular-nums text-ops-text">
                              {formatMoney(overview.bridge.float.deficit, 'USDC')}
                            </div>
                            <div className="text-xs text-ops-muted">
                              used of
                              {' '}
                              {formatMoney(overview.bridge.float.cap, 'USDC')}
                            </div>
                          </div>
                        </div>
                        <UtilizationMeter
                          cap={overview.bridge.float.cap}
                          className="mt-3"
                          deficit={overview.bridge.float.deficit}
                        />
                      </div>
                    )
                  : (
                      <div className="mt-5 rounded-xl border border-dashed border-ops-border px-4 py-3 text-sm text-ops-muted">
                        Bridge float controls are not enabled.
                      </div>
                    )}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Link className="ops-btn-ghost ops-btn-sm" to="/ops/treasury">Treasury</Link>
                  <Link className="ops-btn-ghost ops-btn-sm" to="/ops/treasury/bridge">Bridge</Link>
                </div>
              </div>
              <div className="border-t border-ops-border bg-stone-50/70 px-5 py-3 text-xs text-ops-muted md:px-6">
                {overview.bridge.oldestPendingAt
                  ? `Oldest pending bridge leg: ${formatElapsed(overview.bridge.oldestPendingAt, overview.generatedAt)} ago`
                  : 'No pending bridge legs'}
                {' · Treasury captured '}
                {formatDateTime(overview.treasury.capturedAt)}
              </div>
            </section>
          </div>

          <nav aria-label="Operations quick links" className="ops-card grid min-w-0 gap-1 p-2 sm:grid-cols-2 lg:grid-cols-5">
            <QuickLink description="Search every payment" icon={Activity} label="Transactions" to="/ops/transactions" />
            <QuickLink description="Inspect execution state" icon={Workflow} label="Flows" to="/ops/flows" />
            <QuickLink description="Rank and manage access" icon={Users} label="Partners" to="/ops/partners" />
            <QuickLink description="Balances and movement" icon={WalletCards} label="Treasury" to="/ops/treasury" />
            <QuickLink description="Settlement batches" icon={ArrowLeftRight} label="Bridge" to="/ops/treasury/bridge" />
          </nav>

          {(failedTransactions > 0 || openTransactions > 0) && (
            <p className="text-center text-xs text-ops-muted">
              Current window includes
              {' '}
              {openTransactions.toLocaleString('en-US')}
              {' open and '}
              {failedTransactions.toLocaleString('en-US')}
              {' failed payment outcomes. Use Transactions for record-level investigation.'}
            </p>
          )}
        </div>
      )}
    </OpsPageShell>
  )
}

export default OpsControlTower
