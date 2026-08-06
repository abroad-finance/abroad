import 'reflect-metadata'
import { Prisma, StablebondExecutionDirection, StablebondExecutionStatus, StablebondPositionStatus } from '@prisma/client'

import type { ILockManager } from '../../../../platform/cacheLock/ILockManager'

import { IStablebondVenue, StablebondExecutionResult } from '../../../../modules/treasury/application/contracts/IStablebondVenue'
import { JustInTimeUnwindService } from '../../../../modules/treasury/application/JustInTimeUnwindService'
import { StablebondConfig } from '../../../../modules/treasury/application/stablebondConfig'
import { StablebondPositionRead } from '../../../../modules/treasury/application/StablebondPositionService'
import { createMockLogger } from '../../../setup/mockFactories'

const config: StablebondConfig = {
  assetCode: 'TESOURO',
  fiatCurrency: 'BRL',
  issuer: 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC',
  jitUnwindCapUsdc: 5_000,
  maxSlippageBps: 50,
  receiveAsset: 'USDC',
  symbol: 'TESOURO',
  venue: 'STABLEBOND_POSITION',
}

// NAV 0.242721 USD/token, so 4119.9299 tokens are worth 1000.00 USD at NAV. A
// quote returning exactly 1000 therefore fills at 0 bps, and 990 at ~100 bps.
const NAV_USD = '0.242721'
const TOKENS_FOR_1000_USD = '4119.9299'

const makeRead = (overrides: { heldTokens?: string, withRecord?: boolean } = {}): StablebondPositionRead => ({
  position: {
    config,
    heldTokens: new Prisma.Decimal(overrides.heldTokens ?? '100000'),
    record: overrides.withRecord === false
      ? null
      : {
          entryNavFiat: new Prisma.Decimal('1.2'),
          id: 'position-1',
          openedAt: new Date('2026-08-01T00:00:00.000Z'),
          principalFiat: new Prisma.Decimal('120000'),
          principalTokens: new Prisma.Decimal('100000'),
          status: StablebondPositionStatus.OPEN,
        },
    valuation: {
      annualYieldBps: 1276,
      fiatCurrency: 'BRL',
      navFiat: new Prisma.Decimal('1.238022'),
      navUsd: new Prisma.Decimal(NAV_USD),
      observedAt: new Date('2026-08-06T00:00:00.000Z'),
      symbol: 'TESOURO',
    },
  },
  success: true,
})

type Harness = ReturnType<typeof makeService>

const executeMock = (
  impl: IStablebondVenue['execute'],
) => jest.fn<ReturnType<IStablebondVenue['execute']>, Parameters<IStablebondVenue['execute']>>(impl)

const makeService = (options: {
  execute?: IStablebondVenue['execute']
  existingExecution?: unknown
  read?: StablebondPositionRead
  receiveAmount?: string
  reconcile?: IStablebondVenue['reconcile']
  sendAmount?: string
  trustline?: Awaited<ReturnType<IStablebondVenue['readTrustline']>>
} = {}) => {
  const quote = {
    direction: StablebondExecutionDirection.UNWIND,
    observedAt: new Date(),
    receiveAmount: new Prisma.Decimal(options.receiveAmount ?? '1000'),
    receiveAsset: 'USDC',
    sendAmount: new Prisma.Decimal(options.sendAmount ?? TOKENS_FOR_1000_USD),
    sendAsset: 'TESOURO',
  }

  const create = jest.fn(async () => ({ id: 'execution-1' }))
  const findUnique = jest.fn(async () => options.existingExecution ?? null)
  const update = jest.fn(
    async (args: { data: { failureReason?: string, status: StablebondExecutionStatus } }) => {
      void args
      return { spreadBps: 4 }
    },
  )
  const prisma = { stablebondExecution: { create, findUnique, update } }

  const venue: IStablebondVenue = {
    ensureTrustline: jest.fn(async () => ({ onChainId: 'trust-1', outcome: 'opened' as const })),
    execute: options.execute ?? executeMock(async (_params, persistPrepared) => {
      await persistPrepared({ onChainId: 'hash-1' })
      return { onChainId: 'hash-1', outcome: 'confirmed', receivedAmount: new Prisma.Decimal('999.6') }
    }),
    quoteAsset: 'USDC',
    quoteByReceive: jest.fn(async direction => ({ ...quote, direction })),
    quoteBySend: jest.fn(async direction => ({ ...quote, direction })),
    readTrustline: jest.fn(async () => options.trustline ?? {
      balance: new Prisma.Decimal('100000'),
      limit: new Prisma.Decimal('1000000'),
      outcome: 'present' as const,
    }),
    reconcile: options.reconcile ?? jest.fn(async () => ({ outcome: 'unavailable' as const, reason: 'unreachable' })),
  }

  const positionService = {
    addBasis: jest.fn(async (args: { costFiat: Prisma.Decimal, positionId: string, tokens: Prisma.Decimal }) => {
      void args
      return undefined
    }),
    getConfig: jest.fn<null | StablebondConfig, []>(() => config),
    read: jest.fn(async () => options.read ?? makeRead()),
    releaseBasis: jest.fn(async () => undefined),
  }

  const lockManager: ILockManager = {
    withLock: jest.fn(async <T>(_key: string, _ttl: number, fn: () => Promise<T>) => fn()),
  }

  const service = new JustInTimeUnwindService(
    positionService as never,
    venue,
    lockManager,
    { getClient: jest.fn(async () => prisma) } as never,
    createMockLogger(),
  )

  return {
    create, findUnique, lockManager, positionService, prisma, quote, service, update, venue,
  }
}

const lastUpdate = (harness: Harness) => harness.update.mock.calls.at(-1)?.[0]

describe('JustInTimeUnwindService.assessFeasibility', () => {
  it('is a no-op when the position is not configured', async () => {
    const { positionService, service } = makeService()
    positionService.getConfig.mockReturnValueOnce(null)

    const result = await service.assessFeasibility(new Prisma.Decimal('1000'))
    expect(result).toEqual({ enabled: false })
    // The disabled path must not reach the position or the venue at all.
    expect(positionService.read).not.toHaveBeenCalled()
  })

  it('accepts a quote inside the slippage bound', async () => {
    const { service } = makeService({ receiveAmount: '1000' })
    const result = await service.assessFeasibility(new Prisma.Decimal('1000'))

    expect(result).toEqual(expect.objectContaining({ enabled: true, feasible: true, spreadBps: 0 }))
  })

  it('refuses a quote past the slippage bound rather than executing it', async () => {
    // 990 USDC for tokens worth 1000 at NAV is 100 bps, twice the 50 bps bound.
    const { service, venue } = makeService({ receiveAmount: '990' })
    const result = await service.assessFeasibility(new Prisma.Decimal('1000'))

    expect(result).toEqual({ enabled: true, feasible: false, reason: 'slippage_bound_exceeded' })
    expect(venue.execute).not.toHaveBeenCalled()
  })

  it('refuses when the venue has no path at all', async () => {
    const { service, venue } = makeService()
    jest.mocked(venue.quoteByReceive).mockResolvedValueOnce(null)

    expect(await service.assessFeasibility(new Prisma.Decimal('1000')))
      .toEqual({ enabled: true, feasible: false, reason: 'no_unwind_path' })
  })

  it('refuses when the quote would consume more tokens than are held', async () => {
    const { service } = makeService({ read: makeRead({ heldTokens: '10' }) })

    expect(await service.assessFeasibility(new Prisma.Decimal('1000')))
      .toEqual({ enabled: true, feasible: false, reason: 'insufficient_position' })
  })

  // The invariant that matters most: an unreadable position is not an empty one.
  it('refuses on an unreadable position instead of assuming zero', async () => {
    const { positionService, service, venue } = makeService()
    positionService.read.mockResolvedValueOnce({ reason: 'position_balance_unreadable', success: false })

    expect(await service.assessFeasibility(new Prisma.Decimal('1000')))
      .toEqual({ enabled: true, feasible: false, reason: 'position_balance_unreadable' })
    expect(venue.quoteByReceive).not.toHaveBeenCalled()
  })

  it('refuses a request above the configured JIT cap without asking the venue', async () => {
    const { service, venue } = makeService()

    expect(await service.assessFeasibility(new Prisma.Decimal('5000.01')))
      .toEqual({ enabled: true, feasible: false, reason: 'above_jit_unwind_cap' })
    expect(venue.quoteByReceive).not.toHaveBeenCalled()
  })

  it('refuses when the quote itself fails rather than treating it as free capacity', async () => {
    const { service, venue } = makeService()
    jest.mocked(venue.quoteByReceive).mockRejectedValueOnce(new Error('horizon down'))

    expect(await service.assessFeasibility(new Prisma.Decimal('1000')))
      .toEqual({ enabled: true, feasible: false, reason: 'unwind_quote_unavailable' })
  })
})

describe('JustInTimeUnwindService.unwind', () => {
  it('persists the execution before the venue is asked to act', async () => {
    const order: string[] = []
    const harness = makeService({
      execute: executeMock(async (_params, persistPrepared) => {
        order.push('venue.execute')
        await persistPrepared({ onChainId: 'hash-1' })
        order.push('persistPrepared')
        return { onChainId: 'hash-1', outcome: 'confirmed', receivedAmount: new Prisma.Decimal('999.6') }
      }),
    })
    harness.create.mockImplementationOnce(async () => {
      order.push('create')
      return { id: 'execution-1' }
    })

    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result.outcome).toBe('confirmed')
    expect(order).toEqual(['create', 'venue.execute', 'persistPrepared'])
  })

  it('holds a lock on the position across the whole critical section', async () => {
    const harness = makeService()
    await harness.service.unwind({ idempotencyKey: 'payout-1', requiredUsdc: new Prisma.Decimal('1000') })

    expect(harness.lockManager.withLock).toHaveBeenCalledWith(
      'stablebond-unwind:TESOURO:STABLEBOND_POSITION',
      expect.any(Number),
      expect.any(Function),
    )
  })

  it('sends a floor that covers the requirement and bounds drift from the quote', async () => {
    const harness = makeService({ receiveAmount: '1010' })
    await harness.service.unwind({ idempotencyKey: 'payout-1', requiredUsdc: new Prisma.Decimal('1000') })

    // 1010 less the 50 bps tolerance is 1004.95, which binds harder than the
    // 1000 the caller needs, so it is the floor that goes on chain.
    expect(jest.mocked(harness.venue.execute).mock.calls[0][0].minReceive.toFixed()).toBe('1004.95')
  })

  it('never lets the on-chain floor fall below what the caller needs', async () => {
    const harness = makeService({ receiveAmount: '1000' })
    await harness.service.unwind({ idempotencyKey: 'payout-1', requiredUsdc: new Prisma.Decimal('1000') })

    expect(jest.mocked(harness.venue.execute).mock.calls[0][0].minReceive.toFixed()).toBe('1000')
  })

  it('records the spread actually paid against the NAV it quoted at', async () => {
    const harness = makeService()
    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    // Tokens worth 1000.00 at NAV filled for 999.6 -> 4 bps.
    expect(result).toEqual(expect.objectContaining({ outcome: 'confirmed', spreadBps: 4 }))
    expect(harness.positionService.releaseBasis).toHaveBeenCalledWith(
      expect.objectContaining({ positionId: 'position-1' }),
    )
  })

  it('refuses without submitting when the quote is past the bound', async () => {
    const harness = makeService({ receiveAmount: '990' })
    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual({ outcome: 'refused', reason: 'slippage_bound_exceeded' })
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.venue.execute).not.toHaveBeenCalled()
  })

  it('marks an ambiguous submission ambiguous and leaves it for reconciliation', async () => {
    const ambiguous: StablebondExecutionResult = {
      onChainId: 'hash-1',
      outcome: 'ambiguous',
      reason: 'stellar_submission_ambiguous',
    }
    const harness = makeService({
      execute: executeMock(async (_params, persistPrepared) => {
        await persistPrepared({ onChainId: 'hash-1' })
        return ambiguous
      }),
    })

    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual(expect.objectContaining({ onChainId: 'hash-1', outcome: 'ambiguous' }))
    expect(lastUpdate(harness)?.data.status).toBe(StablebondExecutionStatus.AMBIGUOUS)
    // An ambiguous unwind must never release basis: we do not know it sold.
    expect(harness.positionService.releaseBasis).not.toHaveBeenCalled()
  })

  it('reconciles an in-flight execution read-only instead of executing again', async () => {
    const reconcile = jest.fn(async () => ({
      onChainId: 'hash-1',
      outcome: 'confirmed' as const,
      receivedAmount: new Prisma.Decimal('999.6'),
    }))
    const harness = makeService({
      existingExecution: {
        failureReason: null,
        id: 'execution-1',
        onChainId: 'hash-1',
        receivedAmount: null,
        spreadBps: null,
        status: StablebondExecutionStatus.SUBMITTED,
      },
      reconcile,
    })

    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'confirmed' }))
    expect(reconcile).toHaveBeenCalledWith('hash-1')
    // The whole point: no second sale.
    expect(harness.venue.execute).not.toHaveBeenCalled()
    expect(harness.create).not.toHaveBeenCalled()
  })

  it('keeps an unreconcilable in-flight execution ambiguous rather than retrying it', async () => {
    const harness = makeService({
      existingExecution: {
        failureReason: 'stellar_submission_ambiguous',
        id: 'execution-1',
        onChainId: 'hash-1',
        receivedAmount: null,
        spreadBps: null,
        status: StablebondExecutionStatus.AMBIGUOUS,
      },
      reconcile: jest.fn(async () => ({ outcome: 'absent' as const })),
    })

    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'ambiguous', reason: 'venue_has_no_record_yet' }))
    expect(harness.venue.execute).not.toHaveBeenCalled()
  })

  it('returns the settled execution for a repeated idempotency key without re-selling', async () => {
    const harness = makeService({
      existingExecution: {
        failureReason: null,
        id: 'execution-1',
        onChainId: 'hash-1',
        receivedAmount: new Prisma.Decimal('999.6'),
        spreadBps: 4,
        status: StablebondExecutionStatus.CONFIRMED,
      },
    })

    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'confirmed', spreadBps: 4 }))
    expect(harness.venue.execute).not.toHaveBeenCalled()
    expect(harness.venue.reconcile).not.toHaveBeenCalled()
  })

  it('refuses to unwind a position whose basis has never been registered', async () => {
    const harness = makeService({ read: makeRead({ withRecord: false }) })

    const result = await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual({ outcome: 'refused', reason: 'position_basis_not_registered' })
    expect(harness.venue.execute).not.toHaveBeenCalled()
  })

  it('refuses when the position is disabled, without taking a lock', async () => {
    const harness = makeService()
    harness.positionService.getConfig.mockReturnValueOnce(null)

    expect(await harness.service.unwind({
      idempotencyKey: 'payout-1',
      requiredUsdc: new Prisma.Decimal('1000'),
    })).toEqual({ outcome: 'refused', reason: 'stablebond_position_disabled' })
    expect(harness.lockManager.withLock).not.toHaveBeenCalled()
  })
})

describe('JustInTimeUnwindService.acquire', () => {
  // The buy leg is the mirror of the unwind and must carry the same guarantees:
  // with no issuer relationship this public venue is the only way into the
  // position as well as the only way out.
  const acquireQuote = { receiveAmount: '4119.9299', sendAmount: '1000' }

  it('refuses before quoting when the trustline is not open', async () => {
    const harness = makeService({ ...acquireQuote, trustline: { outcome: 'absent' } })

    expect(await harness.service.acquire({
      idempotencyKey: 'buy-1',
      spendQuoteAsset: new Prisma.Decimal('1000'),
    })).toEqual({ outcome: 'refused', reason: 'trustline_not_open' })
    // Acquiring without a trustline fails on chain after the fee is spent.
    expect(harness.venue.quoteBySend).not.toHaveBeenCalled()
    expect(harness.venue.execute).not.toHaveBeenCalled()
  })

  it('buys at the quote and adds the tokens it actually received to the basis', async () => {
    const harness = makeService({
      ...acquireQuote,
      execute: executeMock(async (_params, persistPrepared) => {
        await persistPrepared({ onChainId: 'hash-2' })
        return { onChainId: 'hash-2', outcome: 'confirmed', receivedAmount: new Prisma.Decimal('4119') }
      }),
    })

    const result = await harness.service.acquire({
      idempotencyKey: 'buy-1',
      spendQuoteAsset: new Prisma.Decimal('1000'),
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'confirmed' }))
    // Basis is taken from the fill, never from the quote.
    const basis = harness.positionService.addBasis.mock.calls.at(0)?.[0]
    expect(basis?.positionId).toBe('position-1')
    expect(basis?.tokens.toFixed()).toBe('4119')
    // 1000 USDC restated in BRL through the issuer's own FX: navFiat/navUsd is
    // 1.238022/0.242721 = 5.100597, which is Etherfuse's own published rate.
    expect(basis?.costFiat.toFixed(6)).toBe('5100.596982')
  })

  it('refuses an acquisition that would pay more than the bound above NAV', async () => {
    // 1000 USDC for 4000 tokens worth 970.88 at NAV is ~300 bps over.
    const harness = makeService({ receiveAmount: '4000', sendAmount: '1000' })

    expect(await harness.service.acquire({
      idempotencyKey: 'buy-1',
      spendQuoteAsset: new Prisma.Decimal('1000'),
    })).toEqual({ outcome: 'refused', reason: 'slippage_bound_exceeded' })
    expect(harness.venue.execute).not.toHaveBeenCalled()
  })

  it('leaves the basis alone when the fill could not be measured', async () => {
    const harness = makeService({
      ...acquireQuote,
      execute: executeMock(async (_params, persistPrepared) => {
        await persistPrepared({ onChainId: 'hash-2' })
        return { onChainId: 'hash-2', outcome: 'confirmed', receivedAmount: null }
      }),
    })

    await harness.service.acquire({
      idempotencyKey: 'buy-1',
      spendQuoteAsset: new Prisma.Decimal('1000'),
    })

    // Re-basing from a guess would corrupt every accrual after it.
    expect(harness.positionService.addBasis).not.toHaveBeenCalled()
  })

  it('refuses a non-positive spend without taking a lock', async () => {
    const harness = makeService(acquireQuote)

    expect(await harness.service.acquire({
      idempotencyKey: 'buy-1',
      spendQuoteAsset: new Prisma.Decimal('0'),
    })).toEqual({ outcome: 'refused', reason: 'non_positive_amount' })
    expect(harness.lockManager.withLock).not.toHaveBeenCalled()
  })

  it('re-attaches to a settled acquisition rather than buying twice', async () => {
    const harness = makeService({
      ...acquireQuote,
      existingExecution: {
        failureReason: null,
        id: 'execution-9',
        onChainId: 'hash-2',
        receivedAmount: new Prisma.Decimal('4119'),
        spreadBps: 6,
        status: StablebondExecutionStatus.CONFIRMED,
      },
    })

    expect(await harness.service.acquire({
      idempotencyKey: 'buy-1',
      spendQuoteAsset: new Prisma.Decimal('1000'),
    })).toEqual(expect.objectContaining({ executionId: 'execution-9', outcome: 'confirmed' }))
    expect(harness.venue.execute).not.toHaveBeenCalled()
  })
})
