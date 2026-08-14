import 'reflect-metadata'
import { Prisma, StablebondExecutionDirection, StablebondExecutionStatus, StablebondPositionStatus } from '@prisma/client'

import type { StablebondTrustlineResult } from '../../../../modules/treasury/application/contracts/IStablebondVenue'
import type { StablebondUnwindFeasibility } from '../../../../modules/treasury/application/JustInTimeUnwindService'
import type { StablebondPositionRead } from '../../../../modules/treasury/application/StablebondPositionService'

import { OpsStablebondService } from '../../../../modules/treasury/application/OpsStablebondService'
import { YieldAccrualService } from '../../../../modules/treasury/application/YieldAccrualService'
import { createMockLogger } from '../../../setup/mockFactories'

const ISSUER = 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC'

const config = {
  assetCode: 'TESOURO',
  fiatCurrency: 'BRL',
  issuer: ISSUER,
  jitUnwindCapUsdc: 5_000,
  maxSlippageBps: 50,
  receiveAsset: 'USDC' as const,
  symbol: 'TESOURO',
  venue: 'STABLEBOND_POSITION' as const,
}

const goodRead: StablebondPositionRead = {
  position: {
    config,
    heldTokens: new Prisma.Decimal('1000'),
    record: {
      entryNavFiat: new Prisma.Decimal('1.2'),
      id: 'position-1',
      openedAt: new Date('2026-08-01T00:00:00.000Z'),
      principalFiat: new Prisma.Decimal('1200'),
      principalTokens: new Prisma.Decimal('1000'),
      status: StablebondPositionStatus.OPEN,
    },
    valuation: {
      annualYieldBps: 1276,
      fiatCurrency: 'BRL',
      navFiat: new Prisma.Decimal('1.238022'),
      navUsd: new Prisma.Decimal('0.242721'),
      observedAt: new Date('2026-08-06T00:00:00.000Z'),
      symbol: 'TESOURO',
    },
  },
  success: true,
}

const unwindRow = {
  direction: StablebondExecutionDirection.UNWIND,
  failureReason: null,
  id: 'execution-1',
  minReceive: new Prisma.Decimal('1000'),
  navUsdPerToken: new Prisma.Decimal('0.242721'),
  onChainId: 'abc123',
  quotedAt: new Date('2026-08-06T10:00:00.000Z'),
  quotedReceive: new Prisma.Decimal('1000.4'),
  receiveAsset: 'USDC',
  receivedAmount: new Prisma.Decimal('999.6'),
  sendAmount: new Prisma.Decimal('4119.9299'),
  sendAsset: 'TESOURO',
  settledAt: new Date('2026-08-06T10:00:05.000Z'),
  spreadBps: 4,
  status: StablebondExecutionStatus.CONFIRMED,
}

const makeService = (options: {
  feasibility?: StablebondUnwindFeasibility
  read?: StablebondPositionRead
  unwinds?: unknown[]
} = {}) => {
  const findMany = jest.fn(async () => options.unwinds ?? [unwindRow])
  const positionService = { read: jest.fn(async () => options.read ?? goodRead) }
  const unwindService = {
    acquire: jest.fn(),
    assessFeasibility: jest.fn(async () => options.feasibility ?? {
      enabled: true as const,
      feasible: true as const,
      sellTokens: new Prisma.Decimal('20000'),
      spreadBps: 4,
    }),
    unwind: jest.fn(),
  }
  const venue = {
    ensureTrustline: jest.fn<Promise<StablebondTrustlineResult>, []>(
      async () => ({ onChainId: 'trust-1', outcome: 'opened' }),
    ),
    readTrustline: jest.fn(),
  }

  const service = new OpsStablebondService(
    positionService as never,
    new YieldAccrualService(),
    unwindService as never,
    venue as never,
    { getClient: jest.fn(async () => ({ stablebondExecution: { findMany } })) } as never,
    createMockLogger(),
  )
  return {
    findMany, positionService, service, unwindService, venue,
  }
}

describe('OpsStablebondService', () => {
  const previousEnv = { ...process.env }

  beforeEach(() => {
    process.env.STABLEBOND_ISSUER = ISSUER
    process.env.STABLEBOND_JIT_UNWIND_CAP_USDC = '5000'
  })

  afterEach(() => {
    process.env = { ...previousEnv }
  })

  it('reports the position with its accrual and a live unwind probe', async () => {
    const { service } = makeService()
    const overview = await service.getOverview()

    expect(overview.enabled).toBe(true)
    expect(overview.error).toBeNull()
    expect(overview.position).toEqual(expect.objectContaining({
      accruedFiat: 38.022,
      annualYieldBps: 1276,
      heldTokens: 1000,
      symbol: 'TESOURO',
      valueFiat: 1238.022,
    }))
    expect(overview.position?.unwindable).toEqual({
      feasible: true,
      reason: null,
      spreadBps: 4,
      testedUsdc: 5_000,
    })
  })

  it('says why the position is off without reaching for a position at all', async () => {
    delete process.env.STABLEBOND_JIT_UNWIND_CAP_USDC
    const { positionService, service } = makeService()

    const overview = await service.getOverview()
    expect(overview).toEqual({
      disabledReason: 'STABLEBOND_JIT_UNWIND_CAP_USDC is not set',
      enabled: false,
      error: null,
      position: null,
      recentUnwinds: [],
    })
    expect(positionService.read).not.toHaveBeenCalled()
  })

  // An enabled-but-unreadable position must reach the console as an error, not
  // as a zero position an operator would read as "we hold nothing".
  it('surfaces an unreadable position as an error, never as a zero position', async () => {
    const { service } = makeService({
      read: { reason: 'position_balance_unreadable', success: false },
    })

    const overview = await service.getOverview()
    expect(overview.enabled).toBe(true)
    expect(overview.error).toBe('position_balance_unreadable')
    expect(overview.position).toBeNull()
    // The execution history is still useful while the live read is broken.
    expect(overview.recentUnwinds).toHaveLength(1)
  })

  it('reports an infeasible unwind with its reason rather than hiding it', async () => {
    const { service } = makeService({
      feasibility: { enabled: true, feasible: false, reason: 'no_unwind_path' },
    })

    expect((await service.getOverview()).position?.unwindable).toEqual({
      feasible: false,
      reason: 'no_unwind_path',
      spreadBps: null,
      testedUsdc: 5_000,
    })
  })

  it('exposes the spread each execution actually paid alongside its quote', async () => {
    const { service } = makeService()
    const [unwind] = (await service.getOverview()).recentUnwinds

    expect(unwind).toEqual(expect.objectContaining({
      direction: StablebondExecutionDirection.UNWIND,
      minReceive: 1000,
      quotedReceive: 1000.4,
      receivedAmount: 999.6,
      sendAmount: 4119.9299,
      spreadBps: 4,
      status: StablebondExecutionStatus.CONFIRMED,
    }))
  })

  // The dashboard polls, and the probe hits a public venue with its own rate
  // limit. Spending that quota on a panel refresh is the mistake the Transfero
  // balance endpoints already taught this system.
  it('caches the feasibility probe across repeated dashboard reads', async () => {
    const { service, unwindService } = makeService()

    await service.getOverview()
    await service.getOverview()

    expect(unwindService.assessFeasibility).toHaveBeenCalledTimes(1)
  })

  describe('unwind', () => {
    it('rejects a non-positive acquisition amount before reaching the venue', async () => {
      const { service, unwindService } = makeService()

      await expect(service.acquire({ spendUsdc: 0 }, 'key-1')).rejects.toThrow(/positive number/)
      expect(unwindService.acquire).not.toHaveBeenCalled()
    })

    it('scopes the acquisition key the same way it scopes an unwind', async () => {
      const { service, unwindService } = makeService()
      unwindService.acquire.mockResolvedValueOnce({
        executionId: 'execution-2',
        onChainId: 'abc456',
        outcome: 'confirmed',
        receivedAmount: new Prisma.Decimal('4100'),
        spreadBps: 6,
      })

      await service.acquire({ spendUsdc: 1_000 }, 'operator-key')

      expect(unwindService.acquire).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: 'ops:operator-key',
      }))
    })

    it('reports the trustline outcome without inventing a balance', async () => {
      const { service } = makeService()

      expect(await service.openTrustline()).toEqual({
        balance: null,
        limit: null,
        onChainId: 'trust-1',
        outcome: 'opened',
        reason: null,
      })
    })

    it('reports an already-open trustline with its balance', async () => {
      const { service, venue } = makeService()
      venue.ensureTrustline.mockResolvedValueOnce({
        balance: new Prisma.Decimal('1000'),
        limit: new Prisma.Decimal('922337203685.4775807'),
        outcome: 'present' as const,
      })

      expect(await service.openTrustline()).toEqual(expect.objectContaining({
        balance: 1000,
        outcome: 'present',
      }))
    })

    it('rejects a non-positive amount before reaching the unwind service', async () => {
      const { service, unwindService } = makeService()

      await expect(service.unwind({ requiredUsdc: 0 }, 'key-1')).rejects.toThrow(/positive number/)
      expect(unwindService.unwind).not.toHaveBeenCalled()
    })

    it('requires an idempotency key', async () => {
      const { service, unwindService } = makeService()

      await expect(service.unwind({ requiredUsdc: 100 }, '  ')).rejects.toThrow(/idempotency key/)
      expect(unwindService.unwind).not.toHaveBeenCalled()
    })

    it('scopes the operator key so it cannot collide with another caller', async () => {
      const { service, unwindService } = makeService()
      unwindService.unwind.mockResolvedValueOnce({
        executionId: 'execution-1',
        onChainId: 'abc123',
        outcome: 'confirmed',
        receivedAmount: new Prisma.Decimal('999.6'),
        spreadBps: 4,
      })

      await service.unwind({ requiredUsdc: 1_000 }, 'operator-key')

      expect(unwindService.unwind).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: 'ops:operator-key',
      }))
    })

    it('turns a refusal into a 409 rather than a silent no-op', async () => {
      const { service, unwindService } = makeService()
      unwindService.unwind.mockResolvedValueOnce({
        outcome: 'refused',
        reason: 'slippage_bound_exceeded',
      })

      await expect(service.unwind({ requiredUsdc: 1_000 }, 'key-1'))
        .rejects.toThrow(/slippage_bound_exceeded/)
    })

    // An ambiguous unwind must come back as data the operator can act on, not
    // as an error a client would be tempted to retry.
    it('returns an ambiguous outcome with its execution id instead of throwing', async () => {
      const { service, unwindService } = makeService()
      unwindService.unwind.mockResolvedValueOnce({
        executionId: 'execution-1',
        onChainId: 'abc123',
        outcome: 'ambiguous',
        reason: 'stellar_submission_ambiguous',
      })

      expect(await service.unwind({ requiredUsdc: 1_000 }, 'key-1')).toEqual({
        executionId: 'execution-1',
        onChainId: 'abc123',
        outcome: 'ambiguous',
        reason: 'stellar_submission_ambiguous',
        receivedAmount: null,
        spreadBps: null,
      })
    })
  })
})
