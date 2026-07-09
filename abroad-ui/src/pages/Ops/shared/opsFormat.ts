/**
 * Shared formatting helpers for the Ops admin app.
 *
 * These replace ~11 copy-pasted `formatDate`/`formatAmount` helpers and ad-hoc
 * `new Date(x).toLocaleString()` calls scattered across the Ops pages, so dates,
 * amounts and status labels render identically everywhere (fixed `en-US` locale,
 * null-safe, no per-machine drift).
 */

type DateInput = Date | null | number | string | undefined

const toDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const toNumber = (value: null | number | string | undefined): null | number => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Medium date + short time, e.g. "Jul 9, 2026, 10:40 AM". Returns "—" for empty/invalid. */
export const formatDateTime = (value: DateInput): string => {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Date only, e.g. "Jul 9, 2026". Returns "—" for empty/invalid. */
export const formatDate = (value: DateInput): string => {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleDateString('en-US', { dateStyle: 'medium' })
}

/** Fixed 2-decimal money with grouping. Optional currency suffix. Returns "—" for empty/invalid. */
export const formatMoney = (value: null | number | string | undefined, currency?: string): string => {
  const parsed = toNumber(value)
  if (parsed === null) return '—'
  const formatted = parsed.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })
  return currency ? `${formatted} ${currency}` : formatted
}

/** Crypto amount with grouping and up to `maxFractionDigits` decimals. Returns "—" for empty/invalid. */
export const formatAmount = (
  value: null | number | string | undefined,
  maxFractionDigits = 6,
): string => {
  const parsed = toNumber(value)
  if (parsed === null) return '—'
  return parsed.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits })
}

/**
 * Turn a raw enum / snake_case / camelCase status into human copy.
 * e.g. "AWAITING_PAYMENT" -> "Awaiting payment", "alreadyProcessed" -> "Already processed".
 */
export const humanizeStatus = (raw: null | string | undefined): string => {
  if (!raw) return '—'
  const spaced = raw
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return raw
  const lower = spaced.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}
