/**
 * Rounds a float to a fixed number of decimal places for presentation.
 *
 * The `Number.EPSILON` nudge is deliberate: without it, values that are already
 * a hair below the midpoint in binary floating point (the classic 1.005 case)
 * round down and read as a cent short in ops dashboards.
 *
 * This is a DISPLAY helper. It must not be used to derive a value that is
 * settled, paid out, or persisted as an exact amount — those paths carry
 * currency and precision explicitly and use decimal arithmetic. Each caller
 * passes its own `decimals` because the precision is part of that read model's
 * contract, not a property of money in general.
 */
export function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}
