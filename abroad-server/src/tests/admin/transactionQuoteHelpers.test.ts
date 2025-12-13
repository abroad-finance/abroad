import type { ActionRequest } from 'adminjs'

import { TransactionStatus } from '@prisma/client'

import { buildActionRequestSearchParams, ensureDefaultTransactionQuoteFilters, flattenActionParams, normalizeQueryParams } from '../../app/admin/transactionQuoteFilters'
import {
  applyQuoteProjection,
  assignTransactionMetadata,
  escapeCsvValue,
  formatDateTime,
  hydratePersonaAndQuoteFields,
  parseNumber,
} from '../../app/admin/transactionQuoteFormatters'

const DEFAULTS = {
  currency: 'COP',
  status: TransactionStatus.PAYMENT_COMPLETED,
} as const

describe('transactionQuoteFilters helpers', () => {
  it('applies default filters to empty requests', () => {
    const request: ActionRequest = {
      method: 'get' as const,
      params: { action: 'list', resourceId: 'resource' },
      query: {},
    }
    const ensured = ensureDefaultTransactionQuoteFilters(request, DEFAULTS)

    expect(ensured.query?.filters).toEqual({
      targetCurrency: DEFAULTS.currency,
      transactionStatus: DEFAULTS.status,
    })
    expect(ensured.query?.['filters.targetCurrency']).toBe(DEFAULTS.currency)
    expect(ensured.query?.['filters.transactionStatus']).toBe(DEFAULTS.status)
  })

  it('respects existing currency while enforcing status defaults', () => {
    const request: ActionRequest = {
      method: 'post' as const,
      params: { action: 'list', resourceId: 'resource' },
      payload: {
        'filters': { targetCurrency: 'USD' },
        'filters.targetCurrency': 'USD',
        'filters.transactionStatus': TransactionStatus.PAYMENT_FAILED,
      },
      query: {
        'filters': { targetCurrency: 'USD' },
        'filters.targetCurrency': 'USD',
        'filters.transactionStatus': TransactionStatus.PAYMENT_FAILED,
      },
    }

    const ensured = ensureDefaultTransactionQuoteFilters(request, DEFAULTS)

    expect(ensured.query?.['filters.targetCurrency']).toBe('USD')
    expect(ensured.query?.['filters.transactionStatus']).toBe(DEFAULTS.status)
    expect(ensured.payload?.['filters.targetCurrency']).toBe('USD')
    expect(ensured.payload?.['filters.transactionStatus']).toBe(DEFAULTS.status)
  })

  it('builds search params using flat adapter', () => {
    const flat = {
      flatten: (input: Record<string, unknown>) => input,
    }
    const query = { 'filters.targetCurrency': 'COP' }
    const payload = { 'filters.transactionStatus': DEFAULTS.status }

    const params = buildActionRequestSearchParams(flat, {
      method: 'get',
      params: { action: 'list', resourceId: 'resource' },
      payload,
      query,
    })

    expect(params).toContain('filters.targetCurrency=COP')
    expect(params).toContain(`filters.transactionStatus=${DEFAULTS.status}`)
  })

  it('normalizes query params by using the last value of arrays', () => {
    const normalized = normalizeQueryParams({
      emptyArray: [],
      multi: ['first', 'second'],
      single: 'value',
    })

    expect(normalized.single).toBe('value')
    expect(normalized.multi).toBe('second')
    expect(normalized.emptyArray).toBeUndefined()
  })

  it('returns normalized params when query object is missing', () => {
    expect(normalizeQueryParams(undefined)).toEqual({})
  })

  it('flattens action params while skipping undefined or null entries', () => {
    const adapter = {
      flatten: (input: Record<string, unknown>) => input,
    }
    const entries = flattenActionParams(adapter, {
      active: undefined,
      codes: ['A', 'B'],
      description: null,
      value: 'ok',
    })

    expect(entries).toEqual([['codes', 'A'], ['codes', 'B'], ['value', 'ok']])
  })
})

describe('transactionQuoteFormatters helpers', () => {
  it('parses numeric values and gracefully handles invalid input', () => {
    expect(parseNumber('1,234.50')).toBeCloseTo(1234.5)
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber(undefined)).toBeNull()
    expect(parseNumber(42)).toBe(42)
    expect(parseNumber(Number.NaN)).toBeNull()
  })

  it('hydrates persona and quote fields with currency-aware labels', () => {
    const record: { params: Record<string, unknown> } = {
      params: { cryptoCurrency: 'USDC', sourceAmount: '5', targetAmount: '1000', targetCurrency: 'COP' },
    }

    hydratePersonaAndQuoteFields(record, null, new Set(['BRL', 'COP']))

    expect(record.params.montoCop).toBe('1.000,00')
    expect(record.params.montoUsdc).toBe('5,00')
    expect(record.params.tipoOperacion).toBe('Venta')
  })

  it('applies quote projection for non-fiat targets', () => {
    const record: { params: Record<string, unknown> } = { params: {} }

    applyQuoteProjection(record, {
      cryptoCurrency: 'BTC',
      fiatCurrencies: new Set(['COP']),
      sourceAmount: 2,
      targetAmount: 100_000,
      targetCurrency: 'USD',
    })

    expect(record.params.montoCop).toBe('')
    expect(record.params.montoUsdc).toBe('')
    expect(record.params.tipoOperacion).toBe('Compra')
  })

  it('escapes CSV fields and formats dates defensively', () => {
    expect(escapeCsvValue('a,"b"')).toBe('"a,""b"""')
    expect(escapeCsvValue({ key: 'value' })).toBe('"{"\"key\"":"\"value\""}"')
    const timestamp = new Date('2024-01-02T03:04:05Z')
    expect(escapeCsvValue(timestamp)).toBe(timestamp.toISOString())
    expect(escapeCsvValue(null)).toBe('')
    expect(formatDateTime('')).toBe('')
    expect(formatDateTime('2024-01-02T03:04:05Z')).toBe('2024-01-02 03:04')
  })

  it('assigns transaction metadata even when target currency is not a string', () => {
    const record: { params: Record<string, unknown> } = {
      params: { onChainId: 1234, targetCurrency: 999, transactionCreatedAt: '2024-05-06T07:08:09Z' },
    }

    assignTransactionMetadata(record, record.params.transactionCreatedAt, record.params.onChainId, new Set(['COP']))

    expect(record.params.hashTransaccion).toBe('')
    expect(record.params.tipoOperacion).toBe('Compra')
    expect(record.params.fecha).toBe('2024-05-06 07:08')
  })
})
