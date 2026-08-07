import 'reflect-metadata'
import { Prisma, StablebondPositionStatus } from '@prisma/client'

import { ITreasuryBalanceSource } from '../../../../modules/treasury/application/contracts/ITreasuryBalanceSource'
import { StablebondPositionService } from '../../../../modules/treasury/application/StablebondPositionService'
import { createMockLogger } from '../../../setup/mockFactories'

const ISSUER = 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC'

const valuation = {
  annualYieldBps: 1276,
  fiatCurrency: 'BRL',
  navFiat: new Prisma.Decimal('1.238022'),
  navUsd: new Prisma.Decimal('0.242721'),
  observedAt: new Date('2026-08-06T00:00:00.000Z'),
  symbol: 'TESOURO',
}

const positionRow = {
  entryNavFiat: new Prisma.Decimal('1.2'),
  id: 'position-1',
  openedAt: new Date('2026-08-01T00:00:00.000Z'),
  principalFiat: new Prisma.Decimal('1200'),
  principalTokens: new Prisma.Decimal('1000'),
  status: StablebondPositionStatus.OPEN,
}

type PositionCreateData = {
  principalFiat: Prisma.Decimal
  principalTokens: Prisma.Decimal
}

type PositionUpdateData = {
  closedAt: Date | null
  principalFiat: Prisma.Decimal
  principalTokens: Prisma.Decimal
  status: StablebondPositionStatus
}

const makeService = (options: {
  balances?: () => Promise<unknown>
  positionRow?: unknown
  valuation?: () => Promise<unknown>
} = {}) => {
  const source = {
    getBalances: jest.fn(options.balances ?? (async () => [{
      account: 'GACCOUNT',
      amount: 1000,
      availableAmount: 0,
      blockedAmount: 1000,
      currency: 'TESOURO',
      outstandingAmount: null,
      reservedAmount: null,
      venue: 'STABLEBOND_POSITION',
    }])),
    venue: 'STABLEBOND_POSITION' as const,
  } as unknown as ITreasuryBalanceSource

  // `??` would fall through on an explicit null, which is exactly the case the
  // missing-row test needs to set up.
  const findUnique = jest.fn(async () => ('positionRow' in options ? options.positionRow : positionRow))
  const update = jest.fn(async (args: { data: PositionUpdateData }) => {
    void args
    return undefined
  })
  const upsert = jest.fn(async (args: { create: PositionCreateData }) => {
    void args
    return positionRow
  })
  const prisma = { stablebondPosition: { findUnique, update, upsert } }
  const oracle = { getValuation: jest.fn(options.valuation ?? (async () => valuation)) }

  const service = new StablebondPositionService(
    [source],
    oracle as never,
    { getClient: jest.fn(async () => prisma) } as never,
    createMockLogger(),
  )
  return { findUnique, oracle, service, source, update, upsert }
}

describe('StablebondPositionService', () => {
  const previousEnv = { ...process.env }

  beforeEach(() => {
    process.env.STABLEBOND_ISSUER = ISSUER
    process.env.STABLEBOND_JIT_UNWIND_CAP_USDC = '5000'
  })

  afterEach(() => {
    process.env = { ...previousEnv }
  })

  it('reads tokens from the chain and NAV from the issuer', async () => {
    const { service } = makeService()
    const read = await service.read()

    expect(read.success).toBe(true)
    if (!read.success) return
    expect(read.position.heldTokens.toFixed()).toBe('1000')
    expect(read.position.valuation.navFiat.toFixed()).toBe('1.238022')
    expect(read.position.record?.id).toBe('position-1')
  })

  // The invariant: an unreadable balance must refuse, never resolve to zero.
  it('refuses when the balance source throws', async () => {
    const { service } = makeService({
      balances: async () => { throw new Error('horizon unreachable') },
    })

    expect(await service.read()).toEqual({ reason: 'position_balance_unreadable', success: false })
  })

  it('refuses when the valuation cannot be read', async () => {
    const { service } = makeService({
      valuation: async () => { throw new Error('etherfuse 503') },
    })

    expect(await service.read()).toEqual({ reason: 'position_valuation_unreadable', success: false })
  })

  it('refuses when the asset is not present in the venue balances at all', async () => {
    const { service } = makeService({ balances: async () => [] })
    expect(await service.read()).toEqual({ reason: 'asset_not_held:TESOURO', success: false })
  })

  // Valuing a BRL bond at a USD price would silently misstate the position by
  // the whole FX rate.
  it('refuses a valuation quoted in a different currency than the position', async () => {
    const { service } = makeService({
      valuation: async () => ({ ...valuation, fiatCurrency: 'USD' }),
    })

    expect(await service.read()).toEqual({ reason: 'position_valuation_currency_mismatch', success: false })
  })

  it('is disabled, and reads nothing, when no cap is configured', async () => {
    delete process.env.STABLEBOND_JIT_UNWIND_CAP_USDC
    const { service, source } = makeService()

    expect(await service.read()).toEqual({ reason: 'stablebond_position_disabled', success: false })
    expect(source.getBalances).not.toHaveBeenCalled()
    expect(service.getConfig()).toBeNull()
  })

  it('registers the basis at the currently held quantity and the live NAV', async () => {
    const { service, upsert } = makeService()
    const result = await service.registerBasis()

    expect(result.success).toBe(true)
    const create = upsert.mock.calls.at(0)?.[0].create
    // 1000 tokens at 1.238022 is exactly 1238.022 BRL.
    expect(create?.principalTokens.toFixed()).toBe('1000')
    expect(create?.principalFiat.toFixed()).toBe('1238.022')
  })

  it('refuses to register a basis when no tokens are held', async () => {
    const { service, upsert } = makeService({
      balances: async () => [{
        account: 'GACCOUNT',
        amount: 0,
        availableAmount: 0,
        blockedAmount: 0,
        currency: 'TESOURO',
        outstandingAmount: null,
        reservedAmount: null,
        venue: 'STABLEBOND_POSITION',
      }],
    })

    expect(await service.registerBasis()).toEqual({ reason: 'no_tokens_held', success: false })
    expect(upsert).not.toHaveBeenCalled()
  })

  describe('releaseBasis', () => {
    it('retires basis in proportion to the tokens sold', async () => {
      const { service, update } = makeService()
      await service.releaseBasis({ positionId: 'position-1', soldTokens: new Prisma.Decimal('250') })

      const data = update.mock.calls.at(0)?.[0].data
      // Selling a quarter of a 1000-token / 1200-BRL lot leaves 750 tokens on
      // 900 BRL, so the entry NAV of the remaining lot is unchanged.
      expect(data?.principalTokens.toFixed()).toBe('750')
      expect(data?.principalFiat.toFixed()).toBe('900')
      expect(data?.status).toBe(StablebondPositionStatus.OPEN)
    })

    it('closes the lot when the whole position is sold', async () => {
      const { service, update } = makeService()
      await service.releaseBasis({ positionId: 'position-1', soldTokens: new Prisma.Decimal('1000') })

      const data = update.mock.calls.at(0)?.[0].data
      expect(data?.principalFiat.toFixed()).toBe('0')
      expect(data?.status).toBe(StablebondPositionStatus.CLOSED)
      expect(data?.closedAt).toBeInstanceOf(Date)
    })

    // Releasing more basis than exists would push the principal negative and
    // turn a fully realised lot into phantom accrued yield.
    it('never retires more basis than the lot holds', async () => {
      const { service, update } = makeService()
      await service.releaseBasis({ positionId: 'position-1', soldTokens: new Prisma.Decimal('9999') })

      const data = update.mock.calls.at(0)?.[0].data
      expect(data?.principalTokens.toFixed()).toBe('0')
      expect(data?.principalFiat.toFixed()).toBe('0')
    })

    it('does nothing when the position row has gone', async () => {
      const { service, update } = makeService({ positionRow: null })
      await service.releaseBasis({ positionId: 'missing', soldTokens: new Prisma.Decimal('10') })
      expect(update).not.toHaveBeenCalled()
    })
  })
})
