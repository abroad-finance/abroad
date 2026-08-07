import { Prisma } from '@prisma/client'

/**
 * Reads what a Stablebond is worth.
 *
 * Implementations MUST throw when the valuation cannot be read. A missing NAV is
 * never a zero and never a stale guess: the position gate and the accrual ledger
 * both treat an unreadable valuation as a refusal, matching how the onramp path
 * already refuses on an unreadable inventory read.
 */
export interface IStablebondOracle {
  getValuation(symbol: string): Promise<StablebondValuation>
}

/**
 * Net asset value and yield for one Etherfuse Stablebond.
 *
 * Every field is exact: the issuer publishes decimal strings and they are parsed
 * as decimals, never through `Number`. This feeds a value ledger.
 */
export type StablebondValuation = {
  /** Live annualised yield in basis points, as the issuer publishes it (1276 = 12.76%). */
  annualYieldBps: number
  /** The bond's sovereign currency — BRL for TESOURO. */
  fiatCurrency: string
  /** NAV per token in the bond's own currency. */
  navFiat: Prisma.Decimal
  /** NAV per token in USD, at the issuer's own FX. */
  navUsd: Prisma.Decimal
  /** When the issuer computed this, not when we read it. */
  observedAt: Date
  symbol: string
}
