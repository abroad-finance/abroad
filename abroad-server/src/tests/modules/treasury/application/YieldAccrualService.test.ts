import 'reflect-metadata'
import { Prisma, StablebondPositionStatus } from '@prisma/client'

import { ValuedStablebondPosition } from '../../../../modules/treasury/application/StablebondPositionService'
import { YieldAccrualService } from '../../../../modules/treasury/application/YieldAccrualService'

const OPENED_AT = new Date('2026-08-01T00:00:00.000Z')

const config = {
  assetCode: 'TESOURO',
  fiatCurrency: 'BRL',
  issuer: 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC',
  jitUnwindCapUsdc: 5_000,
  maxSlippageBps: 50,
  receiveAsset: 'USDC' as const,
  symbol: 'TESOURO',
  venue: 'STABLEBOND_POSITION' as const,
}

const makePosition = (overrides: {
  entryNavFiat?: string
  heldTokens?: string
  navFiat?: string
  navUsd?: string
  principalFiat?: string
  principalTokens?: string
  withRecord?: boolean
} = {}): ValuedStablebondPosition => ({
  config,
  heldTokens: new Prisma.Decimal(overrides.heldTokens ?? '1000'),
  record: overrides.withRecord === false
    ? null
    : {
        entryNavFiat: new Prisma.Decimal(overrides.entryNavFiat ?? '1.2'),
        id: 'position-1',
        openedAt: OPENED_AT,
        principalFiat: new Prisma.Decimal(overrides.principalFiat ?? '1200'),
        principalTokens: new Prisma.Decimal(overrides.principalTokens ?? '1000'),
        status: StablebondPositionStatus.OPEN,
      },
  valuation: {
    annualYieldBps: 1276,
    fiatCurrency: 'BRL',
    navFiat: new Prisma.Decimal(overrides.navFiat ?? '1.238022'),
    navUsd: new Prisma.Decimal(overrides.navUsd ?? '0.242721'),
    observedAt: OPENED_AT,
    symbol: 'TESOURO',
  },
})

describe('YieldAccrualService', () => {
  const service = new YieldAccrualService()

  // The whole point of Prisma.Decimal here: 1000 * 1.238022 is 1238.022 exactly,
  // and 1238.022 - 1200 is 38.022 exactly. In binary floating point the same
  // subtraction yields 38.02199999999993, which would be wrong in a value ledger.
  it('values the position and accrues yield to the exact decimal', () => {
    const accrual = service.accrue(makePosition(), new Date('2026-08-02T00:00:00.000Z'))

    expect(accrual.valueFiat.toFixed()).toBe('1238.022')
    expect(accrual.accruedFiat.toFixed()).toBe('38.022')
    expect(accrual.principalFiat?.toFixed()).toBe('1200')
    // Binary floating point does not produce this string.
    expect(1000 * 1.238022 - 1200).not.toBe(38.022)
  })

  it('converts accrued fiat to USD through the position own NAV pair', () => {
    // 38.022 BRL at 1.238022 BRL / 0.242721 USD per token.
    const accrual = service.accrue(makePosition(), new Date('2026-08-02T00:00:00.000Z'))
    const expected = new Prisma.Decimal('38.022')
      .times('0.242721')
      .dividedBy('1.238022')
      .toDecimalPlaces(18, Prisma.Decimal.ROUND_HALF_UP)

    expect(accrual.accruedUsd.toFixed()).toBe(expected.toFixed())
  })

  it('reports a loss as a negative accrual rather than clamping it to zero', () => {
    const accrual = service.accrue(
      makePosition({ navFiat: '1.15', navUsd: '0.2254' }),
      new Date('2026-08-02T00:00:00.000Z'),
    )

    expect(accrual.accruedFiat.toFixed()).toBe('-50')
    expect(accrual.accruedFiat.isNegative()).toBe(true)
  })

  it('annualises the realised rate against the elapsed holding period', () => {
    // 38.022 on 1200 over exactly 365 days is 3.1685% -> 317 bps (half-up).
    const accrual = service.accrue(makePosition(), new Date('2027-08-01T00:00:00.000Z'))

    expect(accrual.elapsedMs).toBe(365 * 24 * 60 * 60 * 1_000)
    expect(accrual.effectiveAnnualBps).toBe(317)
  })

  it('scales the realised rate up for a partial year', () => {
    // 36.5 days is a tenth of a year, so the same 38.022 earned in a tenth of
    // the time annualises to ten times the rate.
    const accrual = service.accrue(makePosition(), new Date('2026-09-06T12:00:00.000Z'))
    expect(accrual.effectiveAnnualBps).toBe(3169)
  })

  it('withholds the realised rate until an hour has been held', () => {
    const accrual = service.accrue(makePosition(), new Date('2026-08-01T00:30:00.000Z'))

    expect(accrual.effectiveAnnualBps).toBeNull()
    // The accrual itself is still reported; only the annualisation is withheld.
    expect(accrual.accruedFiat.toFixed()).toBe('38.022')
  })

  it('reports the issuer published rate independently of what has been realised', () => {
    const accrual = service.accrue(makePosition(), new Date('2026-08-02T00:00:00.000Z'))
    expect(accrual.annualYieldBps).toBe(1276)
  })

  it('accrues nothing when no cost basis has been registered', () => {
    const accrual = service.accrue(makePosition({ withRecord: false }), new Date('2026-08-02T00:00:00.000Z'))

    // The position is still valued — we know what it is worth. What we do not
    // know is what it cost, and calling the whole mark "yield" would invent it.
    expect(accrual.valueFiat.toFixed()).toBe('1238.022')
    expect(accrual.accruedFiat.toFixed()).toBe('0')
    expect(accrual.principalFiat).toBeNull()
    expect(accrual.effectiveAnnualBps).toBeNull()
  })

  it('accrues nothing when the recorded basis is zero', () => {
    const accrual = service.accrue(
      makePosition({ principalFiat: '0', principalTokens: '0' }),
      new Date('2026-08-02T00:00:00.000Z'),
    )
    expect(accrual.accruedFiat.toFixed()).toBe('0')
    expect(accrual.principalFiat).toBeNull()
  })

  it('never reports a negative elapsed period for a timestamp before the basis', () => {
    const accrual = service.accrue(makePosition(), new Date('2026-07-01T00:00:00.000Z'))
    expect(accrual.elapsedMs).toBe(0)
    expect(accrual.effectiveAnnualBps).toBeNull()
  })
})
