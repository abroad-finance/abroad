import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { Link } from 'react-router-dom'

import type { OpsTreasuryBalanceCell, OpsTreasuryThresholdInput } from '../../services/admin/treasuryTypes'

import { useOpsApiKey, useOpsSession } from '../../services/admin/opsAuthStore'
import {
  createTreasuryThreshold,
  getTreasuryBalances,
  getTreasuryMovements,
  getTreasurySnapshots,
  updateTreasuryThreshold,
} from '../../services/admin/treasuryAdminApi'
import {
  OpsTreasuryBalancesResponse,
  OpsTreasuryMovementsResponse,
  OpsTreasurySnapshotsResponse,
} from '../../services/admin/treasuryTypes'
import {
  formatAmount,
  formatDateTime,
  formatMoney,
  OpsBanner,
  OpsDialog,
  OpsEmptyState,
  OpsField,
  OpsLoading,
  OpsPageShell,
  OpsStatusBadge,
  UtilizationMeter,
} from './shared'
import { isOpsMutationCancelledError, useOpsMutation } from './shared/opsMutationContext'

// Categorical palette (validated: worst adjacent CVD dE 24.2, light surface).
// Color follows the venue entity, never its rank — a missing venue must not
// repaint the others.
const VENUE_COLORS: Record<string, string> = {
  BINANCE: '#2a78d6',
  CELO_HOT_WALLET: '#008300',
  MOVII: '#e34948',
  SOLANA_HOT_WALLET: '#4a3aa7',
  STELLAR_HOT_WALLET: '#eda100',
  TRANSFERO: '#1baf7a',
}
const FALLBACK_SERIES_COLOR = '#e87ba4'

const VENUE_LABELS: Record<string, string> = {
  BINANCE: 'Binance',
  CELO_HOT_WALLET: 'Celo hot wallet',
  MOVII: 'Movii (COP)',
  SOLANA_HOT_WALLET: 'Solana hot wallet',
  STELLAR_HOT_WALLET: 'Stellar hot wallet',
  TRANSFERO: 'Transfero',
}

const CHROME = {
  baseline: '#c3c2b7',
  gridline: '#e1e0d9',
  muted: '#898781',
}

const RANGE_PRESETS = [
  7,
  30,
  90,
] as const

const venueColor = (venue: string): string => VENUE_COLORS[venue] ?? FALLBACK_SERIES_COLOR
const venueLabel = (venue: string): string => VENUE_LABELS[venue] ?? venue

const compactUsd = (value: null | number): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 1,
    notation: 'compact',
    style: 'currency',
  }).format(value)
}

const postureTone = (state: OpsTreasuryBalanceCell['posture']['state']) => {
  if (state === 'CRITICAL') return 'danger' as const
  if (state === 'WARNING') return 'warning' as const
  if (state === 'OK') return 'success' as const
  return 'neutral' as const
}

const balanceComponent = (value: null | number, currency: string): string => (
  value === null ? 'Not reported' : formatMoney(value, currency)
)

const niceTicks = (max: number, count = 4): number[] => {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const rawStep = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude
  const ticks: number[] = []
  // The last tick must reach max or the tallest mark clips past the plot top.
  for (let tick = 0; ticks.length < 12; tick += step) {
    ticks.push(tick)
    if (tick >= max) break
  }
  return ticks
}

type LinePoint = { at: number, value: number }
type LineSeries = { color: string, label: string, points: LinePoint[] }

type LineTooltip = {
  at: number
  rows: { color: string, label: string, value: null | number }[]
}

const LINE_W = 720
const LINE_H = 240
const PAD = {
  bottom: 24, left: 52, right: 16, top: 12,
}

const LineChart = ({ series }: { series: LineSeries[] }) => {
  const [tooltip, setTooltip] = useState<LineTooltip | null>(null)
  const svgRef = useRef<null | SVGSVGElement>(null)

  const {
    allTicks,
    maxX,
    minX,
    ticksY,
  } = useMemo(() => {
    const xs = series.flatMap(entry => entry.points.map(point => point.at))
    const ys = series.flatMap(entry => entry.points.map(point => point.value))
    const uniqueTicks = [...new Set(xs)].sort((a, b) => a - b)
    const top = Math.max(1, ...ys)
    return {
      allTicks: uniqueTicks,
      maxX: uniqueTicks.length ? uniqueTicks[uniqueTicks.length - 1] : 1,
      minX: uniqueTicks.length ? uniqueTicks[0] : 0,
      ticksY: niceTicks(top),
    }
  }, [series])

  const plotW = LINE_W - PAD.left - PAD.right
  const plotH = LINE_H - PAD.top - PAD.bottom
  const yMax = ticksY[ticksY.length - 1] || 1
  const xFor = (at: number): number => PAD.left + (maxX === minX ? plotW / 2 : ((at - minX) / (maxX - minX)) * plotW)
  const yFor = (value: number): number => PAD.top + plotH - (value / yMax) * plotH

  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || allTicks.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * LINE_W
    let nearest = allTicks[0]
    for (const tick of allTicks) {
      if (Math.abs(xFor(tick) - px) < Math.abs(xFor(nearest) - px)) nearest = tick
    }
    setTooltip({
      at: nearest,
      rows: series.map(entry => ({
        color: entry.color,
        label: entry.label,
        value: entry.points.find(point => point.at === nearest)?.value ?? null,
      })),
    })
  }

  if (series.every(entry => entry.points.length === 0)) {
    return (
      <div className="py-10 text-center text-sm text-ops-muted">
        No snapshots yet — the worker captures balances hourly, so history accrues after the next deploy tick.
      </div>
    )
  }

  return (
    <div className="relative">
      <svg
        aria-label="Balance over time by venue (USD)"
        className="w-full"
        onPointerLeave={() => setTooltip(null)}
        onPointerMove={handlePointer}
        ref={svgRef}
        role="img"
        viewBox={`0 0 ${LINE_W} ${LINE_H}`}
      >
        {ticksY.map(tick => (
          <g key={tick}>
            <line
              stroke={tick === 0 ? CHROME.baseline : CHROME.gridline}
              strokeWidth={1}
              x1={PAD.left}
              x2={LINE_W - PAD.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
            />
            <text fill={CHROME.muted} fontSize={10} textAnchor="end" x={PAD.left - 6} y={yFor(tick) + 3}>
              {compactUsd(tick)}
            </text>
          </g>
        ))}
        {[minX, maxX].filter((value, index, arr) => arr.indexOf(value) === index).map(tick => (
          <text
            fill={CHROME.muted}
            fontSize={10}
            key={tick}
            textAnchor={tick === maxX && tick !== minX ? 'end' : 'start'}
            x={xFor(tick)}
            y={LINE_H - 6}
          >
            {new Date(tick).toLocaleDateString()}
          </text>
        ))}
        {tooltip && (
          <line
            stroke={CHROME.baseline}
            strokeWidth={1}
            x1={xFor(tooltip.at)}
            x2={xFor(tooltip.at)}
            y1={PAD.top}
            y2={PAD.top + plotH}
          />
        )}
        {series.map((entry) => {
          const path = entry.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(point.at).toFixed(1)},${yFor(point.value).toFixed(1)}`)
            .join(' ')
          const last = entry.points[entry.points.length - 1]
          return (
            <g key={entry.label}>
              {entry.points.length > 1 && (
                <path d={path} fill="none" stroke={entry.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
              )}
              {last && (
                <circle
                  cx={xFor(last.at)}
                  cy={yFor(last.value)}
                  fill={entry.color}
                  r={4}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              )}
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div
          className="pointer-events-none absolute right-2 top-2 z-10 rounded-lg border border-ops-border bg-white px-3 py-2 shadow-lg"
        >
          <div className="text-[11px] text-ops-muted">{new Date(tooltip.at).toLocaleString()}</div>
          {tooltip.rows.map(row => (
            <div className="mt-1 flex items-center gap-2 text-xs" key={row.label}>
              <svg aria-hidden className="h-1 w-3" viewBox="0 0 12 1">
                <rect fill={row.color} height="1" width="12" />
              </svg>
              <span className="font-semibold text-ops-text">{compactUsd(row.value)}</span>
              <span className="text-ops-muted">{row.label}</span>
            </div>
          ))}
        </div>
      )}
      <details className="mt-3 rounded-xl border border-ops-border bg-white/70 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-ops-brand">View balance history data</summary>
        <table className="mb-3 w-full table-fixed text-left text-xs">
          <caption className="sr-only">Balance history by venue and timestamp</caption>
          <thead className="text-ops-muted">
            <tr>
              <th className="w-[42%] py-2 pr-2 font-medium" scope="col">Time</th>
              <th className="w-[30%] py-2 pr-2 font-medium" scope="col">Venue</th>
              <th className="py-2 text-right font-medium" scope="col">USD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {series.flatMap(entry => entry.points.map(point => (
              <tr key={`${entry.label}-${point.at}`}>
                <th className="break-words py-2 pr-2 font-medium text-ops-text" scope="row">{new Date(point.at).toLocaleString()}</th>
                <td className="break-words py-2 pr-2">{entry.label}</td>
                <td className="py-2 text-right tabular-nums">{formatAmount(point.value, 2)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

type BarDatum = { label: string, value: number }

const BAR_W = 340
const BAR_H = 160
const BAR_PAD = {
  bottom: 20, left: 44, right: 8, top: 10,
}

const roundedTopBar = (x: number, y: number, width: number, height: number): string => {
  const radius = Math.min(4, width / 2, height)
  const bottom = y + height
  return [
    `M${x},${bottom}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + width - radius},${y}`,
    `Q${x + width},${y} ${x + width},${y + radius}`,
    `L${x + width},${bottom}`,
    'Z',
  ].join(' ')
}

const BarChart = ({ color, data, title }: { color: string, data: BarDatum[], title: string }) => {
  const [hover, setHover] = useState<null | number>(null)
  const max = Math.max(1, ...data.map(datum => datum.value))
  const ticks = niceTicks(max, 3)
  const yMax = ticks[ticks.length - 1] || 1
  const plotW = BAR_W - BAR_PAD.left - BAR_PAD.right
  const plotH = BAR_H - BAR_PAD.top - BAR_PAD.bottom
  const band = data.length > 0 ? plotW / data.length : plotW
  const thickness = Math.min(24, Math.max(2, band - 2))

  return (
    <div className="ops-card p-3">
      <div className="text-xs font-medium text-ops-muted">{title}</div>
      <div className="relative mt-1">
        <svg aria-label={title} className="w-full" role="img" viewBox={`0 0 ${BAR_W} ${BAR_H}`}>
          {ticks.map(tick => (
            <g key={tick}>
              <line
                stroke={tick === 0 ? CHROME.baseline : CHROME.gridline}
                strokeWidth={1}
                x1={BAR_PAD.left}
                x2={BAR_W - BAR_PAD.right}
                y1={BAR_PAD.top + plotH - (tick / yMax) * plotH}
                y2={BAR_PAD.top + plotH - (tick / yMax) * plotH}
              />
              <text
                fill={CHROME.muted}
                fontSize={9}
                textAnchor="end"
                x={BAR_PAD.left - 5}
                y={BAR_PAD.top + plotH - (tick / yMax) * plotH + 3}
              >
                {compactUsd(tick).replace('$', '')}
              </text>
            </g>
          ))}
          {data.map((datum, index) => {
            const height = (datum.value / yMax) * plotH
            const x = BAR_PAD.left + index * band + (band - thickness) / 2
            const y = BAR_PAD.top + plotH - height
            return (
              <g key={datum.label}>
                {datum.value > 0 && (
                  <path
                    d={roundedTopBar(x, y, thickness, height)}
                    fill={color}
                    opacity={hover === null || hover === index ? 1 : 0.45}
                  />
                )}
                <rect
                  fill="transparent"
                  height={plotH}
                  onPointerEnter={() => setHover(index)}
                  onPointerLeave={() => setHover(null)}
                  width={band}
                  x={BAR_PAD.left + index * band}
                  y={BAR_PAD.top}
                />
              </g>
            )
          })}
          {data.length > 0 && [0, data.length - 1].filter((value, index, arr) => arr.indexOf(value) === index).map(index => (
            <text
              fill={CHROME.muted}
              fontSize={9}
              key={index}
              textAnchor="middle"
              x={BAR_PAD.left + index * band + band / 2}
              y={BAR_H - 6}
            >
              {data[index].label.slice(5)}
            </text>
          ))}
        </svg>
        {hover !== null && data[hover] && (
          <div className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-lg border border-ops-border bg-white px-3 py-1.5 text-xs shadow-lg">
            <span className="font-semibold text-ops-text">{formatAmount(data[hover].value, 2)}</span>
            <span className="ml-2 text-ops-muted">{data[hover].label}</span>
          </div>
        )}
      </div>
      <details className="mt-2 rounded-xl border border-ops-border bg-white/70 px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-ops-brand">View chart data</summary>
        <table className="mb-3 w-full table-fixed text-left text-xs">
          <caption className="sr-only">{title}</caption>
          <thead className="text-ops-muted">
            <tr>
              <th className="py-2 font-medium" scope="col">Date</th>
              <th className="py-2 text-right font-medium" scope="col">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {data.map(datum => (
              <tr key={datum.label}>
                <th className="break-words py-2 pr-2 font-medium text-ops-text" scope="row">{datum.label}</th>
                <td className="py-2 text-right tabular-nums">{formatAmount(datum.value, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

const eventKindLabels: Record<string, string> = {
  BRIDGE_SETTLED: 'Bridge settled',
  CRYPTO_IN: 'Crypto in',
  FIAT_PAYOUT: 'Fiat payout',
}

const TreasuryDashboard = () => {
  const [balances, setBalances] = useState<null | OpsTreasuryBalancesResponse>(null)
  const [movements, setMovements] = useState<null | OpsTreasuryMovementsResponse>(null)
  const [snapshots, setSnapshots] = useState<null | OpsTreasurySnapshotsResponse>(null)
  const [rangeDays, setRangeDays] = useState<number>(7)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [movementLoading, setMovementLoading] = useState(false)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<null | string>(null)
  const [movementError, setMovementError] = useState<null | string>(null)
  const [snapshotError, setSnapshotError] = useState<null | string>(null)
  const [thresholdEditor, setThresholdEditor] = useState<null | {
    id?: string
    input: OpsTreasuryThresholdInput
    version?: number
  }>(null)
  const [thresholdWorking, setThresholdWorking] = useState(false)
  const opsApiKey = useOpsApiKey()
  const session = useOpsSession()
  const { requestMutation } = useOpsMutation()
  const canManageThresholds = Boolean(session?.kind === 'ops_user' && session.permissions.includes('treasury:manage'))
  const balanceRequestSeq = useRef(0)
  const movementRequestSeq = useRef(0)
  const snapshotRequestSeq = useRef(0)

  const loadBalances = useCallback(async () => {
    const seq = ++balanceRequestSeq.current
    if (!opsApiKey) {
      setBalances(null)
      setBalanceLoading(false)
      return
    }
    setBalanceLoading(true)
    setBalanceError(null)
    try {
      const result = await getTreasuryBalances()
      if (seq === balanceRequestSeq.current) setBalances(result)
    }
    catch (err) {
      if (seq === balanceRequestSeq.current) setBalanceError(err instanceof Error ? err.message : 'Balances could not be loaded')
    }
    finally {
      if (seq === balanceRequestSeq.current) setBalanceLoading(false)
    }
  }, [opsApiKey])

  const loadMovements = useCallback(async () => {
    const seq = ++movementRequestSeq.current
    if (!opsApiKey) {
      setMovements(null)
      setMovementLoading(false)
      return
    }
    setMovementLoading(true)
    setMovementError(null)
    try {
      const result = await getTreasuryMovements(rangeDays)
      if (seq === movementRequestSeq.current) setMovements(result)
    }
    catch (err) {
      if (seq === movementRequestSeq.current) setMovementError(err instanceof Error ? err.message : 'Movement history could not be loaded')
    }
    finally {
      if (seq === movementRequestSeq.current) setMovementLoading(false)
    }
  }, [opsApiKey, rangeDays])

  const loadSnapshots = useCallback(async () => {
    const seq = ++snapshotRequestSeq.current
    if (!opsApiKey) {
      setSnapshots(null)
      setSnapshotLoading(false)
      return
    }
    setSnapshotLoading(true)
    setSnapshotError(null)
    try {
      const result = await getTreasurySnapshots(rangeDays)
      if (seq === snapshotRequestSeq.current) setSnapshots(result)
    }
    catch (err) {
      if (seq === snapshotRequestSeq.current) setSnapshotError(err instanceof Error ? err.message : 'Balance history could not be loaded')
    }
    finally {
      if (seq === snapshotRequestSeq.current) setSnapshotLoading(false)
    }
  }, [opsApiKey, rangeDays])

  useEffect(() => {
    void loadBalances()
  }, [loadBalances])

  useEffect(() => {
    void loadMovements()
    void loadSnapshots()
  }, [loadMovements, loadSnapshots])

  const venueTotals = useMemo(() => {
    if (!balances) return []
    const totals = new Map<string, { hasUnpriced: boolean, usd: number }>()
    for (const cell of balances.cells) {
      const entry = totals.get(cell.venue) ?? { hasUnpriced: false, usd: 0 }
      if (cell.usdValue === null) {
        if (cell.amount !== 0) entry.hasUnpriced = true
      }
      else {
        entry.usd += cell.usdValue
      }
      totals.set(cell.venue, entry)
    }
    for (const venueError of balances.errors) {
      if (!totals.has(venueError.venue)) totals.set(venueError.venue, { hasUnpriced: false, usd: 0 })
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [balances])

  const lineSeries: LineSeries[] = useMemo(() => {
    if (!snapshots) return []
    return snapshots.series
      .map(entry => ({
        color: venueColor(entry.venue),
        label: venueLabel(entry.venue),
        points: entry.points
          .filter(point => point.usdValue !== null)
          .map(point => ({ at: new Date(point.capturedAt).getTime(), value: point.usdValue as number })),
      }))
      // A venue with no priced points draws nothing — keeping it in the legend
      // and tooltip would be an identity chip pointing at no mark.
      .filter(entry => entry.points.length > 0)
  }, [snapshots])

  const movementCharts = useMemo(() => {
    if (!movements) return { fiat: [] as { currency: string, data: BarDatum[] }[], stables: [] as BarDatum[] }
    const stables: BarDatum[] = movements.days.map(day => ({
      label: day.date,
      value: day.inboundCrypto
        .filter(bucket => bucket.currency === 'USDC' || bucket.currency === 'USDT')
        .reduce((sum, bucket) => sum + bucket.amount, 0),
    }))
    const currencies = [...new Set(movements.days.flatMap(day => day.outboundFiat.map(bucket => bucket.currency)))].sort()
    const fiat = currencies.map(currency => ({
      currency,
      data: movements.days.map(day => ({
        label: day.date,
        value: day.outboundFiat.find(bucket => bucket.currency === currency)?.amount ?? 0,
      })),
    }))
    return { fiat, stables }
  }, [movements])

  const float = balances?.float

  const errorByVenue = useMemo(() => {
    const map = new Map<string, string>()
    balances?.errors.forEach(venueError => map.set(venueError.venue, venueError.message))
    return map
  }, [balances])

  const editThreshold = (cell: OpsTreasuryBalanceCell): void => {
    setThresholdEditor({
      id: cell.posture.threshold?.id,
      input: {
        criticalRunwayHours: cell.posture.threshold?.criticalRunwayHours ?? 12,
        currency: cell.currency,
        minimumAvailable: cell.posture.threshold?.minimumAvailable ?? null,
        ownerTeam: cell.posture.ownerTeam ?? 'Finance',
        venue: cell.venue,
        warningRunwayHours: cell.posture.threshold?.warningRunwayHours ?? 24,
      },
      version: cell.posture.threshold?.version,
    })
  }

  const saveThreshold = async (): Promise<void> => {
    if (!thresholdEditor) return
    setThresholdWorking(true)
    setBalanceError(null)
    try {
      await requestMutation({
        action: thresholdEditor.id ? 'treasury.threshold.update' : 'treasury.threshold.create',
        execute: mutation => thresholdEditor.id
          ? updateTreasuryThreshold(thresholdEditor.id, thresholdEditor.input, mutation)
          : createTreasuryThreshold(thresholdEditor.input, mutation),
        expectedVersion: thresholdEditor.version,
        resourceLabel: `${thresholdEditor.input.venue} · ${thresholdEditor.input.currency}`,
        title: thresholdEditor.id ? 'Update treasury threshold' : 'Create treasury threshold',
      })
      setThresholdEditor(null)
      await loadBalances()
    }
    catch (saveError) {
      if (!isOpsMutationCancelledError(saveError)) {
        setBalanceError(saveError instanceof Error ? saveError.message : 'Treasury threshold could not be saved')
      }
    }
    finally {
      setThresholdWorking(false)
    }
  }

  const refreshing = balanceLoading || movementLoading || snapshotLoading

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey || refreshing}
          onClick={() => {
            void loadBalances()
            void loadMovements()
            void loadSnapshots()
          }}
          type="button"
        >
          Refresh all panels
        </button>
      )}
      eyebrow="Money / Treasury"
      keyRequiredMessage="Sign in to load treasury evidence."
      subtitle="Available, blocked, reserved, and outstanding value by venue and currency—with currency-matched runway, alert ownership, and independent panel freshness."
      title="Treasury Posture"
    >
      <section aria-labelledby="current-balances-title" className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ops-text" id="current-balances-title">Current balances</h2>
            <p className="mt-1 text-sm text-ops-muted">Live provider reads; last good data stays visible if a refresh fails.</p>
          </div>
          {balances && (
            <span className="text-xs text-ops-muted">
              Captured
              {formatDateTime(balances.capturedAt)}
              {' '}
              ·
              {balances.freshness.state.toLowerCase()}
            </span>
          )}
        </div>
        {balanceError && (
          <OpsBanner className="mt-4" variant="error">
            Balances refresh failed:
            {balanceError}
            {' '}
            <button className="ml-2 font-semibold underline" onClick={() => void loadBalances()} type="button">Retry this panel</button>
          </OpsBanner>
        )}
        {balances && (
          <div className={balanceLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="ops-card p-5 lg:col-span-1">
                <div className="text-sm text-ops-muted">Indicative priced total</div>
                <div className="mt-1 text-4xl font-semibold text-ops-text">{compactUsd(balances.totalUsd)}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {balances.totalUsdIsPartial && <OpsStatusBadge label="Partial valuation" tone="warning" />}
                  {balances.fxRates.map(rate => (
                    <span className="rounded-full border border-ops-border px-2 py-1 text-ops-muted" key={rate.currency}>
                      1 USD ≈
                      {formatAmount(1 / rate.usdPerUnit, 2)}
                      {' '}
                      {rate.currency}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:col-span-2">
                {venueTotals.map(([venue, total]) => (
                  <div className="ops-card p-4" key={venue}>
                    <div className="flex items-center gap-2 text-xs text-ops-muted">
                      <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 10 10">
                        <circle cx="5" cy="5" fill={venueColor(venue)} r="5" />
                      </svg>
                      {venueLabel(venue)}
                    </div>
                    {errorByVenue.has(venue)
                      ? <OpsStatusBadge className="mt-2" label="Unavailable" tone="danger" />
                      : (
                          <div className="mt-1 text-2xl font-semibold">
                            {compactUsd(total.usd)}
                            {total.hasUnpriced && <span className="ml-1 text-xs text-amber-700">partial</span>}
                          </div>
                        )}
                  </div>
                ))}
              </div>
            </div>

            {float?.enabled && (
              <div className="ops-card mt-4 p-4">
                <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-ops-muted">Bridge float consumed by unsettled legs (already counted at Binance)</span>
                  <span className="font-semibold">
                    {formatAmount(float.deficit, 2)}
                    {' '}
                    /
                    {' '}
                    {formatAmount(float.cap, 2)}
                    {' '}
                    USDC
                  </span>
                </div>
                <UtilizationMeter cap={float.cap} className="mt-3" deficit={float.deficit} />
                <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ops-brand" to="/ops/treasury/bridge">Inspect bridge settlement →</Link>
              </div>
            )}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {balances.cells.map(cell => (
                <article className="ops-card min-w-0 p-5" key={`${cell.venue}-${cell.account}-${cell.currency}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-ops-muted">
                        <svg aria-hidden className="h-2.5 w-2.5" viewBox="0 0 10 10">
                          <circle cx="5" cy="5" fill={venueColor(cell.venue)} r="5" />
                        </svg>
                        {venueLabel(cell.venue)}
                      </div>
                      <h3 className="mt-1 text-xl font-semibold text-ops-text">{cell.currency}</h3>
                    </div>
                    <OpsStatusBadge label={cell.posture.state} tone={postureTone(cell.posture.state)} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3">
                    {[
                      ['Available', cell.availableAmount],
                      ['Blocked', cell.blockedAmount],
                      ['Reserved', cell.reservedAmount],
                      ['Outstanding', cell.outstandingAmount],
                    ].map(([label, value]) => (
                      <div className="rounded-xl bg-ops-bg p-3" key={label as string}>
                        <dt className="text-xs text-ops-muted">{label}</dt>
                        <dd className={`mt-1 text-sm font-semibold ${(value as null | number) === null ? 'text-ops-muted' : 'text-ops-text'}`}>{balanceComponent(value as null | number, cell.currency)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-ops-muted">Ledger total</div>
                      <div className="mt-0.5 font-semibold">{formatMoney(cell.amount, cell.currency)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ops-muted">Runway</div>
                      <div className="mt-0.5 font-semibold">{cell.posture.runwayHours === null ? 'Not enough outflow history' : `${formatAmount(cell.posture.runwayHours, 1)} hr`}</div>
                    </div>
                    <div>
                      <div className="text-xs text-ops-muted">Owner</div>
                      <div className="mt-0.5 font-semibold">{cell.posture.ownerTeam ?? 'Not assigned'}</div>
                    </div>
                  </div>
                  {cell.account && (
                    <div className="mt-3 truncate font-mono text-[11px] text-ops-muted" title={cell.account}>
                      Account reference ·
                      {cell.account}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-ops-border pt-4">
                    {canManageThresholds && <button className="ops-btn-neutral" onClick={() => editThreshold(cell)} type="button">{cell.posture.threshold ? 'Edit thresholds' : 'Configure thresholds'}</button>}
                    {(cell.posture.state === 'CRITICAL' || cell.posture.state === 'WARNING') && <Link className="ops-btn-neutral" to={cell.posture.alertPath}>Open alert context</Link>}
                  </div>
                </article>
              ))}
            </div>
            {balances.cells.length === 0 && <OpsEmptyState className="mt-4">No venue returned a balance cell. Review the venue-specific errors above.</OpsEmptyState>}
          </div>
        )}
        {balanceLoading && !balances && <OpsLoading className="mt-6" label="Loading current balances…" />}
      </section>

      <section aria-labelledby="balance-history-title" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ops-text" id="balance-history-title">Balance history</h2>
            <p className="mt-1 text-sm text-ops-muted">Hourly snapshots load independently from current provider balances.</p>
          </div>
          <div aria-label="Balance history range" className="flex flex-wrap gap-2" role="group">
            {RANGE_PRESETS.map(preset => (
              <button aria-pressed={rangeDays === preset} className={rangeDays === preset ? 'ops-btn-primary' : 'ops-btn-neutral'} key={preset} onClick={() => setRangeDays(preset)} type="button">
                {preset}
                {' '}
                days
              </button>
            ))}
          </div>
        </div>
        {snapshotError && (
          <OpsBanner className="mt-4" variant="error">
            History refresh failed:
            {snapshotError}
            {' '}
            <button className="ml-2 font-semibold underline" onClick={() => void loadSnapshots()} type="button">Retry history</button>
          </OpsBanner>
        )}
        {snapshots && (
          <div className={`ops-card mt-4 p-4 ${snapshotLoading ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-ops-text">Indicative USD by venue</div>
              <div className="flex flex-wrap gap-3 text-xs text-ops-muted">
                {lineSeries.map(entry => (
                  <span className="flex items-center gap-1.5" key={entry.label}>
                    <svg aria-hidden className="h-1 w-4" viewBox="0 0 16 1">
                      <rect fill={entry.color} height="1" width="16" />
                    </svg>
                    {entry.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2"><LineChart series={lineSeries} /></div>
            <div className="mt-2 text-xs text-ops-muted">
              Window
              {formatDateTime(snapshots.from)}
              {' '}
              –
              {formatDateTime(snapshots.to)}
            </div>
          </div>
        )}
        {snapshotLoading && !snapshots && <OpsLoading className="mt-6" label="Loading balance history…" />}
      </section>

      <section aria-labelledby="money-movement-title" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ops-text" id="money-movement-title">Money movement</h2>
            <p className="mt-1 text-sm text-ops-muted">Completed inbound, payout, and bridge evidence for the selected range.</p>
          </div>
          {movements && (
            <span className="text-xs text-ops-muted">
              {movements.days.length}
              {' '}
              UTC day buckets
            </span>
          )}
        </div>
        {movementError && (
          <OpsBanner className="mt-4" variant="error">
            Movement refresh failed:
            {movementError}
            {' '}
            <button className="ml-2 font-semibold underline" onClick={() => void loadMovements()} type="button">Retry movements</button>
          </OpsBanner>
        )}
        {movements && (
          <div className={movementLoading ? 'opacity-60' : ''}>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <BarChart color="#2a78d6" data={movementCharts.stables} title="Stablecoins received per day (USD)" />
              {movementCharts.fiat.map(chart => <BarChart color="#1baf7a" data={chart.data} key={chart.currency} title={`Fiat paid out per day (${chart.currency})`} />)}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {movements.recent.map(event => (
                <article className="ops-card min-w-0 p-4" key={`${event.kind}-${event.reference}-${event.at}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-ops-muted">{formatDateTime(event.at)}</div>
                      <div className="mt-1 text-sm font-semibold text-ops-text">
                        <span aria-hidden>{event.direction === 'IN' ? '↓' : '↑'}</span>
                        {' '}
                        {eventKindLabels[event.kind] ?? event.kind}
                      </div>
                    </div>
                    <div className="text-right font-semibold tabular-nums">{formatMoney(event.amount, event.currency)}</div>
                  </div>
                  <div className="mt-3 break-all font-mono text-xs">
                    {event.kind === 'BRIDGE_SETTLED'
                      ? (
                          <Link className="text-ops-brand" to={`/ops/treasury/bridge?batchId=${encodeURIComponent(event.reference)}`}>
                            Bridge batch
                            {event.reference.slice(0, 8)}
                            …
                          </Link>
                        )
                      : (
                          <Link className="text-ops-brand" to={`/ops/transactions/${event.reference}`}>
                            Transaction
                            {event.reference.slice(0, 8)}
                            …
                          </Link>
                        )}
                  </div>
                </article>
              ))}
              {movements.recent.length === 0 && <OpsEmptyState>No completed movements in this range.</OpsEmptyState>}
            </div>
          </div>
        )}
        {movementLoading && !movements && <OpsLoading className="mt-6" label="Loading money movement…" />}
      </section>

      {thresholdEditor && (
        <OpsDialog description="Runway is calculated only from completed outflow in the same currency. Saving changes alert evaluation but never moves funds." eyebrow="Money / Treasury" onClose={() => setThresholdEditor(null)} title={`${thresholdEditor.id ? 'Edit' : 'Configure'} ${thresholdEditor.input.currency} thresholds`}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <OpsField label="Venue"><input className="ops-input" disabled name="threshold-venue" value={thresholdEditor.input.venue} /></OpsField>
              <OpsField label="Currency"><input className="ops-input" disabled name="threshold-currency" value={thresholdEditor.input.currency} /></OpsField>
            </div>
            <OpsField hint="Alert owner shown on the Treasury and Incident Center pages." label="Owner team"><input autoFocus className="ops-input" maxLength={60} name="threshold-owner" onChange={event => setThresholdEditor(current => current && ({ ...current, input: { ...current.input, ownerTeam: event.target.value } }))} value={thresholdEditor.input.ownerTeam} /></OpsField>
            <OpsField hint={`Amount in ${thresholdEditor.input.currency}; leave blank to use runway only.`} label="Minimum available"><input className="ops-input" min="0" name="threshold-minimum" onChange={event => setThresholdEditor(current => current && ({ ...current, input: { ...current.input, minimumAvailable: event.target.value === '' ? null : Number(event.target.value) } }))} step="any" type="number" value={thresholdEditor.input.minimumAvailable ?? ''} /></OpsField>
            <div className="grid gap-4 sm:grid-cols-2">
              <OpsField label="Warning runway (hours)"><input className="ops-input" min="0" name="threshold-warning-runway" onChange={event => setThresholdEditor(current => current && ({ ...current, input: { ...current.input, warningRunwayHours: event.target.value === '' ? null : Number(event.target.value) } }))} step="any" type="number" value={thresholdEditor.input.warningRunwayHours ?? ''} /></OpsField>
              <OpsField hint="Must not exceed warning runway." label="Critical runway (hours)"><input className="ops-input" min="0" name="threshold-critical-runway" onChange={event => setThresholdEditor(current => current && ({ ...current, input: { ...current.input, criticalRunwayHours: event.target.value === '' ? null : Number(event.target.value) } }))} step="any" type="number" value={thresholdEditor.input.criticalRunwayHours ?? ''} /></OpsField>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-ops-border pt-4 sm:flex-row sm:justify-end">
              <button className="ops-btn-neutral" onClick={() => setThresholdEditor(null)} type="button">Cancel</button>
              <button className="ops-btn-primary" disabled={thresholdWorking || !thresholdEditor.input.ownerTeam.trim()} onClick={() => void saveThreshold()} type="button">Continue to protected save</button>
            </div>
          </div>
        </OpsDialog>
      )}
    </OpsPageShell>
  )
}

export default TreasuryDashboard
