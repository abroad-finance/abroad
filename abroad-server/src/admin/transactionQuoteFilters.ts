import type { TransactionStatus } from '@prisma/client'
import type { ActionRequest } from 'adminjs'

export interface FlatAdapter {
  flatten: (input: Record<string, unknown>) => Record<string, unknown>
}

export interface TransactionQuoteFilterDefaults {
  currency: string
  status: TransactionStatus
}

const currencyDotNotationKey = 'filters.targetCurrency'
const statusDotNotationKey = 'filters.transactionStatus'

export function buildActionRequestSearchParams(flat: FlatAdapter, request: ActionRequest): string {
  const params = new URLSearchParams()

  for (const [key, value] of flattenActionParams(flat, request.payload as Record<string, unknown> | undefined)) {
    params.set(key, value)
  }

  for (const [key, value] of flattenActionParams(flat, request.query as Record<string, unknown> | undefined)) {
    params.set(key, value)
  }

  return params.toString()
}

export function ensureDefaultTransactionQuoteFilters<T extends ActionRequest>(
  request: T,
  defaults: TransactionQuoteFilterDefaults,
): T {
  const normalizedRequest: ActionRequest = { ...request }
  const query = { ...(request.query ?? {}) } as Record<string, unknown>
  const isMissing = (value: unknown) => value === undefined || value === null || String(value).length === 0
  const normalizeFilters = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) }
    }
    return {}
  }

  if (isMissing(query[currencyDotNotationKey])) {
    query[currencyDotNotationKey] = defaults.currency
  }
  query[statusDotNotationKey] = defaults.status

  const queryFilters = normalizeFilters(query.filters)
  if (isMissing(queryFilters.targetCurrency)) {
    queryFilters.targetCurrency = defaults.currency
  }
  queryFilters.transactionStatus = defaults.status
  query.filters = queryFilters

  normalizedRequest.query = query as ActionRequest['query']

  if (request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)) {
    const payload = { ...request.payload } as Record<string, unknown>
    if (isMissing(payload[currencyDotNotationKey])) {
      payload[currencyDotNotationKey] = defaults.currency
    }
    payload[statusDotNotationKey] = defaults.status

    const payloadFilters = normalizeFilters(payload.filters)
    if (isMissing(payloadFilters.targetCurrency)) {
      payloadFilters.targetCurrency = defaults.currency
    }
    payloadFilters.transactionStatus = defaults.status
    payload.filters = payloadFilters

    normalizedRequest.payload = payload as ActionRequest['payload']
  }

  return normalizedRequest as T
}

export function flattenActionParams(flat: FlatAdapter, input?: Record<string, unknown>): Array<[string, string]> {
  if (!input) return []
  const flattened = flat.flatten(input) as Record<string, unknown>
  const entries: Array<[string, string]> = []

  for (const [key, value] of Object.entries(flattened)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      value.forEach(item => entries.push([key, String(item)]))
      continue
    }
    entries.push([key, String(value)])
  }

  return entries
}

export function normalizeQueryParams(rawQuery: ActionRequest['query']): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(rawQuery ?? {})) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        normalized[key] = value[value.length - 1]
      }
      continue
    }
    if (value !== undefined) {
      normalized[key] = value as unknown
    }
  }

  return normalized
}
