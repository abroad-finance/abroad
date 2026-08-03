import {
  describe, expect, it,
} from 'vitest'

import {
  inputValueToUtcIso,
  isValidHalfOpenRange,
  previousEqualRange,
  rangeForPreset,
} from '../pages/Ops/business-performance/businessPerformanceRanges'

describe('businessPerformanceRanges', () => {
  const now = new Date('2026-08-02T15:30:45.000Z')

  it.each([
    [
      'TODAY',
      '2026-08-02T00:00:00.000Z',
      '2026-08-02T15:30:45.000Z',
    ],
    [
      'YESTERDAY',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
    ],
    [
      'LAST_7_DAYS',
      '2026-07-26T15:30:45.000Z',
      '2026-08-02T15:30:45.000Z',
    ],
    [
      'LAST_30_DAYS',
      '2026-07-03T15:30:45.000Z',
      '2026-08-02T15:30:45.000Z',
    ],
    [
      'CURRENT_MONTH',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T15:30:45.000Z',
    ],
    [
      'PREVIOUS_MONTH',
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ],
  ] as const)('builds %s exclusively from UTC boundaries', (preset, from, to) => {
    expect(rangeForPreset(preset, now)).toEqual({ from, to })
  })

  it('derives an immediately preceding comparison with equal millisecond duration', () => {
    expect(previousEqualRange({
      from: '2026-08-01T12:00:00.000Z',
      to: '2026-08-02T15:00:00.000Z',
    })).toEqual({
      from: '2026-07-31T09:00:00.000Z',
      to: '2026-08-01T12:00:00.000Z',
    })
  })

  it('interprets datetime-local control values as UTC, never browser local time', () => {
    expect(inputValueToUtcIso('2026-08-01T00:00')).toBe('2026-08-01T00:00:00.000Z')
    expect(inputValueToUtcIso('2026-02-30T00:00')).toBeNull()
    expect(inputValueToUtcIso('not-a-date')).toBeNull()
  })

  it('rejects non-positive and excessive custom ranges', () => {
    expect(isValidHalfOpenRange({
      from: '2026-08-02T00:00:00.000Z',
      to: '2026-08-02T00:00:00.000Z',
    })).toBe(false)
    expect(isValidHalfOpenRange({
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-08-02T00:00:00.000Z',
    })).toBe(false)
  })
})
