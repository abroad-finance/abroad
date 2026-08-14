import { Prisma } from '@prisma/client'
import { injectable } from 'inversify'

import { ValuedStablebondPosition } from './StablebondPositionService'

type StablebondAccrual = {
  /** Yield earned between the basis timestamp and `at`, in the bond's currency. */
  accruedFiat: Prisma.Decimal
  accruedUsd: Prisma.Decimal
  /** Annualised rate the issuer publishes right now, in basis points. */
  annualYieldBps: number
  /** The instant this accrual is attributed to. */
  at: Date
  /**
   * Rate actually realised since basis, annualised, in basis points. Null until
   * the position has been held long enough for the number to mean anything.
   */
  effectiveAnnualBps: null | number
  elapsedMs: number
  heldTokens: Prisma.Decimal
  /** Null when no basis has been registered — the position is valued, not accrued. */
  principalFiat: null | Prisma.Decimal
  valueFiat: Prisma.Decimal
  valueUsd: Prisma.Decimal
}

const BASIS_POINTS = 10_000
const MILLISECONDS_PER_YEAR = 365 * 24 * 60 * 60 * 1_000
/**
 * Below an hour, annualising divides by a near-zero elapsed time and turns
 * rounding noise in the NAV feed into a headline rate of thousands of percent.
 * The ops panel shows a dash instead, which is the honest answer.
 */
const MIN_ELAPSED_MS_FOR_RATE = 60 * 60 * 1_000
/** Enough places that a rounding step never moves a fiat figure at cent scale. */
const VALUE_DECIMALS = 18

/**
 * Attributes Stablebond yield to a point in time.
 *
 * Mark-to-NAV, not an interest schedule: a Stablebond's yield shows up as its
 * net asset value rising, so the yield earned by the instant of a payout is
 * exactly (tokens held x NAV at that instant) - what the lot cost. That is what
 * makes "our float earns until the millisecond a customer needs it" a measured
 * statement rather than a slogan — the unwind records the NAV it quoted against,
 * so the accrual at the payment timestamp stays reconstructible afterwards.
 *
 * All arithmetic is `Prisma.Decimal`. This is a value ledger and binary floating
 * point has no place in it.
 */
@injectable()
export class YieldAccrualService {
  /**
   * @param at The timestamp to attribute yield to. Defaults to now; the unwind
   * path passes the moment it quoted, so the accrual and the execution agree.
   */
  public accrue(position: ValuedStablebondPosition, at: Date = new Date()): StablebondAccrual {
    const { heldTokens, record, valuation } = position

    const valueFiat = heldTokens.times(valuation.navFiat)
    const valueUsd = heldTokens.times(valuation.navUsd)
    const principalFiat = record ? new Prisma.Decimal(record.principalFiat) : null

    // Without a registered basis there is nothing to accrue against. Reporting
    // the whole mark as yield would invent profit out of the acquisition itself.
    if (!record || !principalFiat || principalFiat.lessThanOrEqualTo(0)) {
      return {
        accruedFiat: new Prisma.Decimal(0),
        accruedUsd: new Prisma.Decimal(0),
        annualYieldBps: valuation.annualYieldBps,
        at,
        effectiveAnnualBps: null,
        elapsedMs: 0,
        heldTokens,
        principalFiat: null,
        valueFiat,
        valueUsd,
      }
    }

    const accruedFiat = valueFiat.minus(principalFiat)
    // Convert through the position's own NAV pair rather than a separate FX
    // read, so the fiat and USD views of one accrual can never disagree.
    const accruedUsd = valuation.navFiat.isZero()
      ? new Prisma.Decimal(0)
      : accruedFiat
          .times(valuation.navUsd)
          .dividedBy(valuation.navFiat)
          .toDecimalPlaces(VALUE_DECIMALS, Prisma.Decimal.ROUND_HALF_UP)
    const elapsedMs = Math.max(0, at.getTime() - record.openedAt.getTime())

    return {
      accruedFiat,
      accruedUsd,
      annualYieldBps: valuation.annualYieldBps,
      at,
      effectiveAnnualBps: this.annualiseBps(accruedFiat, principalFiat, elapsedMs),
      elapsedMs,
      heldTokens,
      principalFiat,
      valueFiat,
      valueUsd,
    }
  }

  private annualiseBps(
    accruedFiat: Prisma.Decimal,
    principalFiat: Prisma.Decimal,
    elapsedMs: number,
  ): null | number {
    if (elapsedMs < MIN_ELAPSED_MS_FOR_RATE) return null
    const bps = accruedFiat
      .dividedBy(principalFiat)
      .times(MILLISECONDS_PER_YEAR)
      .dividedBy(elapsedMs)
      .times(BASIS_POINTS)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    // A marginal loss rounds to negative zero, which would render as "-0 bps".
    return bps.isZero() ? 0 : bps.toNumber()
  }
}
