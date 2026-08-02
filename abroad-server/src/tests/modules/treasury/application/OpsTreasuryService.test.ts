import 'reflect-metadata'

import type { ILogger } from '../../../../core/logging/types'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { ITreasuryBalanceSource } from '../../../../modules/treasury/application/contracts/ITreasuryBalanceSource'
import { OpsTreasuryService } from '../../../../modules/treasury/application/OpsTreasuryService'

type PrismaMock = {
  $queryRaw: jest.Mock
  bridgeBatch: { findMany: jest.Mock }
  opsTreasuryThreshold: { findMany: jest.Mock }
  transaction: { findMany: jest.Mock }
  treasuryBalanceSnapshot: { createMany: jest.Mock, findMany: jest.Mock }
}

const makeLogger = (): ILogger => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}) as unknown as ILogger

const makePrisma = (): PrismaMock => ({
  $queryRaw: jest.fn(async () => []),
  bridgeBatch: { findMany: jest.fn(async () => []) },
  opsTreasuryThreshold: { findMany: jest.fn(async () => []) },
  transaction: { findMany: jest.fn(async () => []) },
  treasuryBalanceSnapshot: {
    createMany: jest.fn(async () => ({ count: 0 })),
    findMany: jest.fn(async () => []),
  },
})

const makeSource = (venue: string, balances: Array<{ account?: string, amount: number, currency: string }>): ITreasuryBalanceSource => ({
  getBalances: jest.fn(async () => balances.map(balance => ({
    account: balance.account ?? '',
    amount: balance.amount,
    availableAmount: balance.amount,
    blockedAmount: 0,
    currency: balance.currency,
    outstandingAmount: 0,
    reservedAmount: 0,
    venue,
  }))),
  venue,
}) as unknown as ITreasuryBalanceSource

const makeFailingSource = (venue: string, message: string): ITreasuryBalanceSource => ({
  getBalances: jest.fn(async () => {
    throw new Error(message)
  }),
  venue,
}) as unknown as ITreasuryBalanceSource

type ServiceDeps = {
  brl?: number
  cap?: number | undefined
  cop?: number
  deficit?: number
  prisma?: PrismaMock
  sources: ITreasuryBalanceSource[]
}

const makeService = (deps: ServiceDeps): { prisma: PrismaMock, service: OpsTreasuryService } => {
  const prisma = deps.prisma ?? makePrisma()
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  // Real providers return crypto-per-fiat (USD per 1 fiat unit, ~1/4000 for
  // COP) — the direction quoteUseCase consumes. Mock the same semantics.
  const exchangeProviderFactory = {
    getExchangeProvider: jest.fn((currency: string) => ({
      getExchangeRate: jest.fn(async () => {
        if (currency === 'COP' && deps.cop !== undefined) return deps.cop
        if (currency === 'BRL' && deps.brl !== undefined) return deps.brl
        throw new Error(`no rate for ${currency}`)
      }),
    })),
  }
  const floatService = {
    getCapUsdc: jest.fn(() => deps.cap),
    getOutstandingDeficit: jest.fn(async () => deps.deficit ?? 0),
  }
  const service = new OpsTreasuryService(
    deps.sources,
    exchangeProviderFactory as never,
    floatService as never,
    dbProvider,
    makeLogger(),
  )
  return { prisma, service }
}

describe('OpsTreasuryService.getBalances', () => {
  it('aggregates cells across venues and rolls up an indicative USD total', async () => {
    const { service } = makeService({
      cap: 1000,
      cop: 1 / 4000,
      deficit: 40,
      sources: [
        makeSource('BINANCE', [{ amount: 100, currency: 'USDC' }, { amount: 400_000, currency: 'COP' }]),
        makeSource('STELLAR_HOT_WALLET', [{ amount: 50, currency: 'USDT' }]),
      ],
    })

    const result = await service.getBalances()

    expect(result.errors).toEqual([])
    expect(result.cells).toHaveLength(3)
    const cop = result.cells.find(cell => cell.currency === 'COP')
    expect(cop?.usdRate).toBeCloseTo(1 / 4000)
    // 400,000 COP at ~4,000 COP/USD is ~$100 — the sanity anchor for the FX
    // direction (a 400k COP float must never roll up as $1.6B).
    expect(cop?.usdValue).toBeCloseTo(100)
    expect(result.totalUsd).toBeCloseTo(100 + 50 + 100)
    expect(result.totalUsdIsPartial).toBe(false)
    expect(result.float).toEqual({ available: 960, cap: 1000, deficit: 40, enabled: true })
    expect(result.freshness.state).toBe('FRESH')
    expect(result.fxRates).toEqual([{ currency: 'COP', usdPerUnit: 1 / 4000 }])
  })

  it('isolates a failing venue as an error entry and marks the total partial', async () => {
    const { service } = makeService({
      sources: [
        makeSource('BINANCE', [{ amount: 10, currency: 'USDC' }]),
        makeFailingSource('TRANSFERO', 'transfero down'),
      ],
    })

    const result = await service.getBalances()

    expect(result.cells).toHaveLength(1)
    expect(result.errors).toEqual([{ message: 'transfero down', venue: 'TRANSFERO' }])
    expect(result.totalUsd).toBe(10)
    expect(result.totalUsdIsPartial).toBe(true)
    expect(result.freshness.state).toBe('PARTIAL')
  })

  it('leaves unpriced currencies out of the USD total and flags partiality', async () => {
    const { service } = makeService({
      sources: [makeSource('BINANCE', [{ amount: 5, currency: 'USDC' }, { amount: 900, currency: 'BRL' }])],
    })

    const result = await service.getBalances()

    const brl = result.cells.find(cell => cell.currency === 'BRL')
    expect(brl?.usdValue).toBeNull()
    expect(result.totalUsd).toBe(5)
    expect(result.totalUsdIsPartial).toBe(true)
  })

  it('serves the second read within the TTL from cache without re-querying venues', async () => {
    const source = makeSource('BINANCE', [{ amount: 1, currency: 'USDC' }])
    const { service } = makeService({ sources: [source] })

    await service.getBalances()
    await service.getBalances()

    expect(source.getBalances).toHaveBeenCalledTimes(1)
  })

  it('calculates currency-matched runway and applies the configured critical posture', async () => {
    const prisma = makePrisma()
    prisma.opsTreasuryThreshold.findMany.mockResolvedValue([{
      criticalRunwayHours: 4,
      currency: 'BRL',
      id: 'threshold-1',
      minimumAvailable: 50,
      ownerTeam: 'Treasury',
      venue: 'TRANSFERO',
      version: 2,
      warningRunwayHours: 12,
    }])
    prisma.$queryRaw.mockResolvedValue([{ averageDailyOutflow: 2_400, currency: 'BRL' }])
    const { service } = makeService({
      brl: 0.2,
      prisma,
      sources: [makeSource('TRANSFERO', [{ amount: 100, currency: 'BRL' }])],
    })

    const result = await service.getBalances()

    expect(result.cells[0].posture).toEqual(expect.objectContaining({
      alertPath: '/ops/incidents?currency=BRL&kind=TREASURY&venue=TRANSFERO',
      averageDailyOutflow: 2_400,
      ownerTeam: 'Treasury',
      runwayHours: 1,
      state: 'CRITICAL',
      threshold: expect.objectContaining({ id: 'threshold-1', version: 2 }),
    }))
  })
})

describe('OpsTreasuryService.getMovements', () => {
  it('buckets completed transactions and settled bridge batches by UTC day', async () => {
    const prisma = makePrisma()
    prisma.transaction.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-07-06T10:00:00Z'),
        id: 'tx-1',
        quote: { cryptoCurrency: 'USDC', sourceAmount: 20, targetAmount: 80_000, targetCurrency: 'COP' },
      },
      {
        createdAt: new Date('2026-07-06T14:00:00Z'),
        id: 'tx-2',
        quote: { cryptoCurrency: 'USDC', sourceAmount: 5, targetAmount: 25, targetCurrency: 'BRL' },
      },
    ])
    prisma.bridgeBatch.findMany.mockResolvedValue([
      { grossAmount: 12, id: 'batch-1', settledAt: new Date('2026-07-05T09:00:00Z') },
    ])

    const { service } = makeService({ prisma, sources: [] })
    const result = await service.getMovements(7)

    const day6 = result.days.find(day => day.date === '2026-07-06')
    expect(day6?.inboundCrypto).toEqual([{ amount: 25, currency: 'USDC' }])
    expect(day6?.outboundFiat).toEqual(expect.arrayContaining([
      { amount: 80_000, currency: 'COP' },
      { amount: 25, currency: 'BRL' },
    ]))
    const day5 = result.days.find(day => day.date === '2026-07-05')
    expect(day5?.bridgeSettledUsdc).toBe(12)
    expect(result.days.length).toBeGreaterThanOrEqual(7)
    expect(result.recent[0].at.getTime()).toBeGreaterThanOrEqual(result.recent[1].at.getTime())
    expect(result.recent).toHaveLength(5)
  })

  it('clamps fractional and out-of-range day windows', async () => {
    const prisma = makePrisma()
    const { service } = makeService({ prisma, sources: [] })

    const day = 24 * 60 * 60 * 1000

    // 2.5 truncates to 2: the window starts at midnight UTC of the previous
    // day, so the covered span is between 1 and 2 full days.
    await service.getMovements(2.5)
    const firstSince: Date = prisma.transaction.findMany.mock.calls[0][0].where.createdAt.gte
    expect(firstSince.getUTCHours()).toBe(0)
    expect(firstSince.getUTCMinutes()).toBe(0)
    const windowMs = Date.now() - firstSince.getTime()
    expect(windowMs).toBeGreaterThanOrEqual(1 * day)
    expect(windowMs).toBeLessThanOrEqual(2 * day + 5_000)

    await service.getMovements(10_000)
    const secondWhere = prisma.transaction.findMany.mock.calls[1][0].where
    const cappedMs = Date.now() - secondWhere.createdAt.gte.getTime()
    expect(cappedMs).toBeLessThanOrEqual(90 * day + 5_000)
  })
})

describe('OpsTreasuryService.getSnapshots', () => {
  it('groups rows into per-venue series summing USD per capture tick', async () => {
    const tickA = new Date('2026-07-06T00:00:00Z')
    const tickB = new Date('2026-07-06T01:00:00Z')
    const prisma = makePrisma()
    prisma.treasuryBalanceSnapshot.findMany.mockResolvedValue([
      { capturedAt: tickA, usdValue: 10, venue: 'BINANCE' },
      { capturedAt: tickA, usdValue: 15, venue: 'BINANCE' },
      { capturedAt: tickB, usdValue: null, venue: 'BINANCE' },
      { capturedAt: tickA, usdValue: 7, venue: 'TRANSFERO' },
    ])

    const { service } = makeService({ prisma, sources: [] })
    const result = await service.getSnapshots(7)

    expect(result.series).toHaveLength(2)
    const binance = result.series.find(series => series.venue === 'BINANCE')
    expect(binance?.points).toEqual([
      { capturedAt: tickA, usdValue: 25 },
      { capturedAt: tickB, usdValue: null },
    ])
  })
})

describe('OpsTreasuryService.captureSnapshot', () => {
  it('persists one row per cell sharing the capture timestamp', async () => {
    const prisma = makePrisma()
    const { service } = makeService({
      prisma,
      sources: [makeSource('BINANCE', [{ amount: 3, currency: 'USDC' }, { amount: 4, currency: 'USDT' }])],
    })

    const result = await service.captureSnapshot()

    expect(result.skipped).toBe(false)
    expect(result.cells).toBe(2)
    const rows = prisma.treasuryBalanceSnapshot.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(rows[0].capturedAt).toEqual(rows[1].capturedAt)
    expect(rows[0]).toMatchObject({ amount: 3, currency: 'USDC', usdValue: 3, venue: 'BINANCE' })
    expect(rows[0]).toMatchObject({ availableAmount: 3, blockedAmount: 0, outstandingAmount: 0, reservedAmount: 0 })
  })

  it('skips the tick entirely when every venue errored', async () => {
    const prisma = makePrisma()
    const { service } = makeService({
      prisma,
      sources: [makeFailingSource('BINANCE', 'down'), makeFailingSource('TRANSFERO', 'down too')],
    })

    const result = await service.captureSnapshot()

    expect(result.skipped).toBe(true)
    expect(prisma.treasuryBalanceSnapshot.createMany).not.toHaveBeenCalled()
  })
})
