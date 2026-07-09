import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { Link } from 'react-router-dom'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import {
  getTreasuryBalances,
  getTreasuryMovements,
  getTreasurySnapshots,
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
  OpsEmptyState,
  OpsLoading,
  OpsPageShell,
  UtilizationMeter,
} from './shared'

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
  xPct: number
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
      xPct: (xFor(nearest) / LINE_W) * 100,
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
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-ops-border bg-white px-3 py-2 shadow-lg"
          style={{ left: `min(max(${tooltip.xPct}%, 10%), 78%)`, transform: 'translateX(-50%)' }}
        >
          <div className="text-[11px] text-ops-muted">{new Date(tooltip.at).toLocaleString()}</div>
          {tooltip.rows.map(row => (
            <div className="mt-1 flex items-center gap-2 text-xs" key={row.label}>
              <span aria-hidden className="inline-block h-0.5 w-3" style={{ backgroundColor: row.color }} />
              <span className="font-semibold text-ops-text">{compactUsd(row.value)}</span>
              <span className="text-ops-muted">{row.label}</span>
            </div>
          ))}
        </div>
      )}
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()
  // Only the newest request may write state — guards against out-of-order
  // responses when the history range switches mid-flight.
  const requestSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    if (!opsApiKey) {
      setBalances(null)
      setMovements(null)
      setSnapshots(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    try {
      const [
        balancesResult,
        movementsResult,
        snapshotsResult,
      ] = await Promise.all([
        getTreasuryBalances(),
        getTreasuryMovements(rangeDays),
        getTreasurySnapshots(rangeDays),
      ])
      if (seq !== requestSeq.current) return
      setBalances(balancesResult)
      setMovements(movementsResult)
      setSnapshots(snapshotsResult)
    }
    catch (err) {
      if (seq !== requestSeq.current) return
      setError(err instanceof Error ? err.message : 'Failed to load treasury data')
    }
    finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [opsApiKey, rangeDays])

  useEffect(() => {
    void load()
  }, [load])

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

  return (
    <OpsPageShell
      actions={(
        <button
          className="ops-btn-ghost"
          disabled={!opsApiKey || loading}
          onClick={() => void load()}
          type="button"
        >
          Refresh
        </button>
      )}
      error={error}
      eyebrow="Treasury"
      keyRequiredMessage="Ops API key required to load treasury data."
      subtitle="Everything we hold across venues, an indicative USD roll-up, and how money has moved."
      title="Balances & Money Movement"
    >
      {balances && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="ops-card p-5 backdrop-blur lg:col-span-1">
              <div className="text-sm text-ops-muted">Total treasury (indicative)</div>
              <div className="mt-1 text-5xl font-semibold text-ops-text">{compactUsd(balances.totalUsd)}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {balances.totalUsdIsPartial && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                    ⚠ partial — some venues or rates unavailable
                  </span>
                )}
                {balances.fxRates.map(rate => (
                  <span className="rounded-full border border-ops-border bg-white px-2 py-0.5 text-ops-muted" key={rate.currency}>
                    1 USD ≈
                    {' '}
                    {formatAmount(1 / rate.usdPerUnit, 2)}
                    {' '}
                    {rate.currency}
                  </span>
                ))}
              </div>
              <div className="mt-3 text-xs text-ops-muted">
                as of
                {' '}
                {formatDateTime(balances.capturedAt)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:col-span-2">
              {venueTotals.map(([venue, total]) => (
                <div className="ops-card p-4 backdrop-blur" key={venue}>
                  <div className="flex items-center gap-2 text-xs text-ops-muted">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: venueColor(venue) }} />
                    {venueLabel(venue)}
                  </div>
                  {errorByVenue.has(venue)
                    ? (
                        <div className="mt-1">
                          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs text-rose-700" title={errorByVenue.get(venue)}>
                            unavailable
                          </span>
                        </div>
                      )
                    : (
                        <div className="mt-1 text-2xl font-semibold text-ops-text">
                          {compactUsd(total.usd)}
                          {total.hasUnpriced && <span className="ml-1 align-top text-xs text-amber-600" title="Holds currency without a USD rate">*</span>}
                        </div>
                      )}
                </div>
              ))}
            </div>
          </div>

          {float?.enabled && (
            <div className="ops-card mt-4 p-4 backdrop-blur">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ops-muted">Bridge float utilization (context — already counted at Binance)</span>
                <span className="font-medium text-ops-text">
                  {formatAmount(float.deficit, 2)}
                  {' '}
                  /
                  {' '}
                  {formatAmount(float.cap, 2)}
                  {' '}
                  USDC outstanding
                </span>
              </div>
              <UtilizationMeter cap={float.cap} className="mt-2" deficit={float.deficit} />
            </div>
          )}

          <div className="ops-card mt-8 overflow-hidden backdrop-blur">
            <h2 className="border-b border-ops-border px-4 py-3 text-sm font-medium text-ops-text">All balances</h2>
            {balances.cells.length === 0
              ? <OpsEmptyState className="m-4">No balances to show.</OpsEmptyState>
              : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
                          <th className="px-4 py-2" scope="col">Venue</th>
                          <th className="px-4 py-2" scope="col">Account</th>
                          <th className="px-4 py-2" scope="col">Currency</th>
                          <th className="px-4 py-2 text-right" scope="col">Amount</th>
                          <th className="px-4 py-2 text-right" scope="col">USD (indicative)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balances.cells.map(cell => (
                          <tr className="border-t border-ops-border" key={`${cell.venue}-${cell.account}-${cell.currency}`}>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-2">
                                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: venueColor(cell.venue) }} />
                                {venueLabel(cell.venue)}
                              </span>
                            </td>
                            <td className="max-w-[180px] truncate px-4 py-2 font-mono text-xs text-ops-muted" title={cell.account}>
                              {cell.account || '—'}
                            </td>
                            <td className="px-4 py-2">{cell.currency}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{formatAmount(cell.amount, 2)}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{cell.usdValue === null ? '—' : compactUsd(cell.usdValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </div>

          <div className="mt-10 flex items-center gap-2">
            <span className="text-sm text-ops-muted">History range:</span>
            {RANGE_PRESETS.map(preset => (
              <button
                className={rangeDays === preset
                  ? 'rounded-full bg-abroad-dark px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-ops-border bg-white px-3 py-1 text-xs text-ops-muted hover:border-abroad-dark'}
                key={preset}
                onClick={() => setRangeDays(preset)}
                type="button"
              >
                Last
                {' '}
                {preset}
                {' '}
                days
              </button>
            ))}
          </div>

          <div className="ops-card mt-4 p-4 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-ops-text">Balance over time (USD, per venue)</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ops-muted">
                {lineSeries.map(entry => (
                  <span className="flex items-center gap-1.5" key={entry.label}>
                    <span aria-hidden className="inline-block h-0.5 w-4" style={{ backgroundColor: entry.color }} />
                    {entry.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-2">
              <LineChart series={lineSeries} />
            </div>
          </div>

          {movements && (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <BarChart
                  color="#2a78d6"
                  data={movementCharts.stables}
                  title="Stablecoins received per day (USD)"
                />
                {movementCharts.fiat.map(chart => (
                  <BarChart
                    color="#1baf7a"
                    data={chart.data}
                    key={chart.currency}
                    title={`Fiat paid out per day (${chart.currency})`}
                  />
                ))}
              </div>

              <div className="ops-card mt-4 overflow-hidden backdrop-blur">
                <h2 className="border-b border-ops-border px-4 py-3 text-sm font-medium text-ops-text">Recent movements</h2>
                {movements.recent.length === 0
                  ? <OpsEmptyState className="m-4">No movements in this window.</OpsEmptyState>
                  : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase tracking-wide text-ops-muted">
                              <th className="px-4 py-2" scope="col">When</th>
                              <th className="px-4 py-2" scope="col">Kind</th>
                              <th className="px-4 py-2 text-right" scope="col">Amount</th>
                              <th className="px-4 py-2" scope="col">Reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {movements.recent.map(event => (
                              <tr className="border-t border-ops-border" key={`${event.kind}-${event.reference}-${event.at}`}>
                                <td className="whitespace-nowrap px-4 py-2 text-ops-muted">{formatDateTime(event.at)}</td>
                                <td className="px-4 py-2">
                                  <span className="rounded-full border border-ops-border bg-white/60 px-2 py-0.5 text-xs text-ops-text">
                                    <span aria-hidden>{event.direction === 'IN' ? '↓' : '↑'}</span>
                                    <span className="sr-only">{event.direction === 'IN' ? 'Inbound' : 'Outbound'}</span>
                                    {' '}
                                    {eventKindLabels[event.kind] ?? event.kind}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                                  {formatMoney(event.amount, event.currency)}
                                </td>
                                <td className="px-4 py-2 font-mono text-xs">
                                  {event.kind === 'BRIDGE_SETTLED'
                                    ? <span className="text-ops-muted">{event.reference}</span>
                                    : (
                                        <Link className="text-ops-brand hover:text-ops-brand-hover" to={`/ops/transactions/${event.reference}`}>
                                          {event.reference.slice(0, 8)}
                                          …
                                        </Link>
                                      )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
              </div>
            </>
          )}
        </div>
      )}

      {loading && opsApiKey && !balances && (
        <OpsLoading className="mt-6" label="Loading treasury data…" />
      )}
    </OpsPageShell>
  )
}

export default TreasuryDashboard
