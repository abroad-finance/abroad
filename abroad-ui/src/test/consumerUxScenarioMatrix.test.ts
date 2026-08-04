import { describe, expect, it } from 'vitest'

import { activityStatusPresentation } from '../features/activity/model/activityPresentation'
import {
  buildSyntheticActivityReceipt,
  buildSyntheticActivityRows,
  SYNTHETIC_ACCESS_MODES,
  SYNTHETIC_ACTIVITY_DATASET_SIZES,
  SYNTHETIC_ACTIVITY_FILTERS,
  SYNTHETIC_ACTIVITY_PAGE_STATES,
  SYNTHETIC_CONDITIONAL_STATES,
  SYNTHETIC_KYC_SCENARIOS,
  SYNTHETIC_UNKNOWN_ACTIVITY_STATUS,
  SYNTHETIC_VIEWPORTS,
  SYNTHETIC_ZOOM_LEVELS,
} from './fixtures/consumerUxScenarios'

describe('consumer UX synthetic scenario matrix', () => {
  it('provides every required Activity scale without external data', () => {
    for (const size of SYNTHETIC_ACTIVITY_DATASET_SIZES) {
      const rows = buildSyntheticActivityRows(size)
      expect(rows).toHaveLength(size)
      expect(new Set(rows.map(row => row.id))).toHaveLength(size)
    }
  })

  it('covers every lifecycle, rail, network, token, amount, and reference condition', () => {
    const rows = buildSyntheticActivityRows(500)
    const receipts = Array.from({ length: 12 }, (_, index) => buildSyntheticActivityReceipt(index))

    expect(new Set(rows.map(row => row.status))).toEqual(new Set([
      'AWAITING_PAYMENT',
      'PAYMENT_COMPLETED',
      'PAYMENT_EXPIRED',
      'PAYMENT_FAILED',
      'PROCESSING_PAYMENT',
      'WRONG_AMOUNT',
    ]))
    expect(new Set(rows.map(row => row.quote.paymentMethod))).toEqual(new Set(['BREB', 'PIX']))
    expect(new Set(rows.map(row => row.quote.network))).toEqual(new Set([
      'CELO',
      'SOLANA',
      'STELLAR',
    ]))
    expect(new Set(rows.map(row => row.quote.sourceCurrency))).toEqual(new Set(['USDC', 'USDT']))
    expect(rows.some(row => row.quote.sourceAmount === 0.01)).toBe(true)
    expect(rows.some(row => row.quote.sourceAmount === 123.456789)).toBe(true)
    expect(rows.some(row => row.quote.sourceAmount === 9_999_999.99)).toBe(true)
    expect(receipts.some(receipt => receipt.effectiveRate === null)).toBe(true)
    expect(receipts.some(receipt => receipt.fee === null)).toBe(true)
    expect(receipts.some(receipt => receipt.references.onChainId === null)).toBe(true)
    expect(receipts.some(receipt => receipt.references.onChainId !== null)).toBe(true)
    expect(receipts.some(receipt => receipt.references.pixEndToEndId !== null)).toBe(true)
    expect(receipts.some(receipt => receipt.references.brebId !== null)).toBe(true)
    expect(activityStatusPresentation(SYNTHETIC_UNKNOWN_ACTIVITY_STATUS)).toMatchObject({
      label: 'Status unavailable',
      tone: 'unknown',
    })
  })

  it('makes every row reachable through bounded server-page semantics', () => {
    const rows = buildSyntheticActivityRows(500)
    const pageSize = 50
    const reachedIds = new Set<string>()

    for (let page = 1; page <= Math.ceil(rows.length / pageSize); page += 1) {
      const start = (page - 1) * pageSize
      rows.slice(start, start + pageSize).forEach(row => reachedIds.add(row.id))
    }

    expect(reachedIds.size).toBe(500)
  })

  it('enumerates data, recovery, KYC, conditional, viewport, zoom, and access states', () => {
    expect(SYNTHETIC_ACTIVITY_PAGE_STATES).toEqual(expect.arrayContaining([
      'loading',
      'refreshing',
      'empty',
      'filtered_empty',
      'error',
      'stale',
      'offline',
    ]))
    expect(SYNTHETIC_ACTIVITY_FILTERS).toEqual(expect.arrayContaining([
      'rail',
      'network',
      'status',
      'date_range',
    ]))
    expect(new Set(SYNTHETIC_KYC_SCENARIOS.map(scenario => scenario.outcome))).toEqual(new Set([
      'approved',
      'cancelled',
      'editing',
      'expired',
      'in_review',
      'rejected',
      'requires_more_info',
      'resumed',
      'submitting',
      'unavailable',
      'upload_error',
      'validation_error',
    ]))
    expect(SYNTHETIC_CONDITIONAL_STATES).toHaveLength(5)
    expect(SYNTHETIC_VIEWPORTS.map(viewport => `${viewport.width}x${viewport.height}`)).toEqual(expect.arrayContaining([
      '320x568',
      '360x800',
      '390x844',
      '844x390',
      '768x1024',
      '1280x640',
    ]))
    expect(SYNTHETIC_ZOOM_LEVELS).toEqual([
      100,
      200,
      400,
    ])
    expect(SYNTHETIC_ACCESS_MODES).toEqual([
      'keyboard',
      'screen_reader',
      'reduced_motion',
    ])
  })

  it('contains only explicit synthetic identifiers and no real-looking customer data', () => {
    const serialized = JSON.stringify({
      receipts: Array.from({ length: 12 }, (_, index) => buildSyntheticActivityReceipt(index)),
      rows: buildSyntheticActivityRows(72),
    })

    expect(serialized).toContain('Synthetic')
    expect(serialized).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(serialized).not.toMatch(/\+\d{10,15}/)
    expect(serialized).not.toContain('000201')
  })
})
