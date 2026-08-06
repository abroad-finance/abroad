import { roundToDecimals } from '../../../platform/money/round'

/** The three shapes that existed before extraction, reproduced verbatim. */
const legacyRoundAmount = (value: number): number => (
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
)
const legacyRoundPercent = (value: number): number => (
  Math.round((value + Number.EPSILON) * 100) / 100
)
const legacyRoundRate = (value: number): number => (
  Math.round((value + Number.EPSILON) * 10) / 10
)

const samples = [
  0,
  -0,
  1,
  -1,
  1.005,
  2.675,
  0.1 + 0.2,
  1234.5678901234,
  -1234.5678901234,
  0.0000004,
  0.0000005,
  0.0000006,
  1e-7,
  1e12 + 0.5,
  Number.MAX_SAFE_INTEGER / 1e6,
]

describe('roundToDecimals', () => {
  it('reproduces the 6-decimal amount rounding exactly', () => {
    for (const value of samples) {
      expect(roundToDecimals(value, 6)).toBe(legacyRoundAmount(value))
    }
  })

  it('reproduces the 2-decimal percent rounding exactly', () => {
    for (const value of samples) {
      expect(roundToDecimals(value, 2)).toBe(legacyRoundPercent(value))
    }
  })

  it('reproduces the 1-decimal rate rounding exactly', () => {
    for (const value of samples) {
      expect(roundToDecimals(value, 1)).toBe(legacyRoundRate(value))
    }
  })

  it('keeps each precision distinct', () => {
    // Guards against a future "simplification" that collapses the call sites
    // onto one shared precision — the differing decimals are behaviour.
    expect(roundToDecimals(1.23456789, 6)).toBe(1.234568)
    expect(roundToDecimals(1.23456789, 2)).toBe(1.23)
    expect(roundToDecimals(1.23456789, 1)).toBe(1.2)
  })

  it('rounds the binary-floating-point midpoint up, which is why EPSILON is there', () => {
    expect(roundToDecimals(1.005, 2)).toBe(1.01)
  })
})
