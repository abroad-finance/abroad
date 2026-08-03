import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { BusinessPerformanceMetric } from '../../../services/admin/businessPerformanceTypes'

type SortKey = 'CHANGE' | 'COMPARISON' | 'CURRENT' | 'METRIC'

const formatValue = (metric: BusinessPerformanceMetric, value: null | number): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  if (metric.unit === 'RATE') return `${value.toFixed(2)}%`
  if (metric.unit === 'COUNT') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  if (metric.currency) {
    return new Intl.NumberFormat('en-US', {
      currency: metric.currency,
      maximumFractionDigits: 2,
      style: 'currency',
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

const formatChange = (metric: BusinessPerformanceMetric): string => {
  if (metric.change === null || !Number.isFinite(metric.change)) return '—'
  const sign = metric.change > 0 ? '+' : ''
  return metric.changeKind === 'PERCENTAGE_POINT'
    ? `${sign}${metric.change.toFixed(2)} pp`
    : `${sign}${metric.change.toFixed(2)}%`
}

export const BusinessPerformanceTable = ({ metrics }: { metrics: BusinessPerformanceMetric[] }) => {
  const [ascending, setAscending] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('METRIC')
  const sorted = useMemo(() => [...metrics].sort((left, right) => {
    const direction = ascending ? 1 : -1
    if (sortKey === 'METRIC') return direction * left.label.localeCompare(right.label)
    const leftValue = sortKey === 'CURRENT'
      ? left.currentValue
      : sortKey === 'COMPARISON' ? left.comparisonValue : left.change
    const rightValue = sortKey === 'CURRENT'
      ? right.currentValue
      : sortKey === 'COMPARISON' ? right.comparisonValue : right.change
    if (leftValue === null) return rightValue === null ? left.label.localeCompare(right.label) : 1
    if (rightValue === null) return -1
    return direction * (leftValue - rightValue || left.label.localeCompare(right.label))
  }), [
    ascending,
    metrics,
    sortKey,
  ])

  const toggleSort = (next: SortKey): void => {
    if (sortKey === next) setAscending(value => !value)
    else {
      setSortKey(next)
      setAscending(next === 'METRIC')
    }
  }
  const icon = (key: SortKey) => sortKey !== key
    ? <ArrowUpDown aria-hidden size={14} />
    : ascending ? <ArrowUp aria-hidden size={14} /> : <ArrowDown aria-hidden size={14} />

  return (
    <section aria-labelledby="performance-table-heading" className="ops-card mt-5 overflow-hidden">
      <div className="border-b border-ops-border px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold text-ops-text" id="performance-table-heading">Business performance</h2>
        <p className="mt-1 text-xs text-ops-muted">Rates change in percentage points; amounts and counts change by percent.</p>
      </div>
      <div className="overflow-x-auto">
        <table aria-labelledby="performance-table-heading" className="min-w-[760px] w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50/90 text-xs uppercase tracking-wide text-ops-muted">
            <tr>
              {([
                ['METRIC', 'Metric'],
                ['CURRENT', 'Current'],
                ['COMPARISON', 'Comparison'],
                ['CHANGE', 'Change'],
              ] as const).map(([key, label]) => (
                <th aria-sort={sortKey === key ? (ascending ? 'ascending' : 'descending') : 'none'} className="px-5 py-3 font-semibold" key={key} scope="col">
                  <button className="inline-flex min-h-11 items-center gap-1.5 hover:text-ops-text" onClick={() => toggleSort(key)} type="button">
                    {label}
                    {icon(key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ops-border">
            {sorted.map(metric => (
              <tr className="bg-white/70 hover:bg-white" key={metric.id}>
                <th className="px-5 py-3.5 font-medium text-ops-text" scope="row">
                  {metric.label}
                  {metric.currency && <span className="ml-2 text-xs font-normal text-ops-muted">{metric.currency}</span>}
                </th>
                <td className="px-5 py-3.5 font-mono tabular-nums text-ops-text">{formatValue(metric, metric.currentValue)}</td>
                <td className="px-5 py-3.5 font-mono tabular-nums text-ops-muted">{formatValue(metric, metric.comparisonValue)}</td>
                <td className="px-5 py-3.5 font-mono tabular-nums text-ops-text">{formatChange(metric)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
