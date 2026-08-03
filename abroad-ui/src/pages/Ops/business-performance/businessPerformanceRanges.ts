import type { BusinessPerformanceRange } from '../../../services/admin/businessPerformanceTypes'

export type BusinessPerformancePreset
  = | 'CURRENT_MONTH'
    | 'CUSTOM'
    | 'LAST_7_DAYS'
    | 'LAST_30_DAYS'
    | 'PREVIOUS_MONTH'
    | 'TODAY'
    | 'YESTERDAY'

export const BUSINESS_PERFORMANCE_PRESETS: Array<{
  label: string
  value: BusinessPerformancePreset
}> = [
  { label: 'Today', value: 'TODAY' },
  { label: 'Yesterday', value: 'YESTERDAY' },
  { label: 'Last 7 Days', value: 'LAST_7_DAYS' },
  { label: 'Last 30 Days', value: 'LAST_30_DAYS' },
  { label: 'Current Month', value: 'CURRENT_MONTH' },
  { label: 'Previous Month', value: 'PREVIOUS_MONTH' },
  { label: 'Custom Range', value: 'CUSTOM' },
]

const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_RANGE_DURATION_MS = 366 * DAY_MS

const utcMidnight = (date: Date): Date => new Date(Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  date.getUTCDate(),
))

export const rangeForPreset = (
  preset: Exclude<BusinessPerformancePreset, 'CUSTOM'>,
  now = new Date(),
): BusinessPerformanceRange => {
  const today = utcMidnight(now)
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  switch (preset) {
    case 'CURRENT_MONTH':
      return { from: currentMonth.toISOString(), to: now.toISOString() }
    case 'LAST_7_DAYS':
      return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString(), to: now.toISOString() }
    case 'LAST_30_DAYS':
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString(), to: now.toISOString() }
    case 'PREVIOUS_MONTH':
      return { from: previousMonth.toISOString(), to: currentMonth.toISOString() }
    case 'TODAY':
      return { from: today.toISOString(), to: now.toISOString() }
    case 'YESTERDAY':
      return {
        from: new Date(today.getTime() - DAY_MS).toISOString(),
        to: today.toISOString(),
      }
    default: {
      const exhaustive: never = preset
      throw new Error(`Unsupported business performance preset: ${String(exhaustive)}`)
    }
  }
}

export const previousEqualRange = (range: BusinessPerformanceRange): BusinessPerformanceRange => {
  const from = new Date(range.from)
  const to = new Date(range.to)
  const duration = to.getTime() - from.getTime()
  return {
    from: new Date(from.getTime() - duration).toISOString(),
    to: from.toISOString(),
  }
}

export const inputValueToUtcIso = (value: string): null | string => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  const iso = date.toISOString()
  return iso.slice(0, 16) === value ? iso : null
}

export const utcIsoToInputValue = (value: string): string => value.slice(0, 16)

export const isValidHalfOpenRange = (range: BusinessPerformanceRange): boolean => (
  new Date(range.from).getTime() < new Date(range.to).getTime()
    && new Date(range.to).getTime() - new Date(range.from).getTime() <= MAX_RANGE_DURATION_MS
)

export const formatUtcRange = (range: BusinessPerformanceRange): string => (
  `${new Date(range.from).toISOString()} inclusive → ${new Date(range.to).toISOString()} exclusive`
)
