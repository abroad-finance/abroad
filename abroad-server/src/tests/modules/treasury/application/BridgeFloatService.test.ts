import { FlowDirection } from '@prisma/client'

import { BridgeFloatService } from '../../../../modules/treasury/application/BridgeFloatService'

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const makeService = (deficit: number, cap = 2000) => {
  const aggregate = jest.fn(async () => ({ _sum: { amount: deficit } }))
  const dbProvider = { getClient: jest.fn(async () => ({ bridgePendingTransfer: { aggregate } })) }
  process.env.BRIDGE_FLOAT_CAP_USDC = String(cap)
  const service = new BridgeFloatService(dbProvider as never, baseLogger as never)
  return { aggregate, service }
}

describe('BridgeFloatService', () => {
  afterEach(() => {
    delete process.env.BRIDGE_FLOAT_CAP_USDC
  })

  it('outstanding deficit sums PENDING + BATCHED legs (not SETTLED)', async () => {
    const { aggregate, service } = makeService(1500)
    const deficit = await service.getOutstandingDeficit('USDC' as never)
    expect(deficit).toBe(1500)
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ asset: 'USDC', status: { in: expect.arrayContaining(['BATCHED', 'PENDING']) } }),
    }))
  })

  it('allows a transaction when deficit + amount stays within the float cap', async () => {
    const { service } = makeService(1500, 2000)
    const result = await service.canSettle({ amount: 400, asset: 'USDC' as never })
    expect(result.ok).toBe(true)
    expect(result.deficit).toBe(1500)
    expect(result.cap).toBe(2000)
  })

  it('rejects a transaction when deficit + amount would exceed the float cap', async () => {
    const { service } = makeService(1800, 2000)
    const result = await service.canSettle({ amount: 300, asset: 'USDC' as never })
    expect(result.ok).toBe(false) // 1800 + 300 = 2100 > 2000
  })

  it('is disabled (allows everything, no deficit query) when no cap is configured', async () => {
    delete process.env.BRIDGE_FLOAT_CAP_USDC
    const aggregate = jest.fn(async () => ({ _sum: { amount: 9999 } }))
    const dbProvider = { getClient: jest.fn(async () => ({ bridgePendingTransfer: { aggregate } })) }
    const service = new BridgeFloatService(dbProvider as never, baseLogger as never)
    const result = await service.canSettle({ amount: 1_000_000, asset: 'USDC' as never })
    expect(result.ok).toBe(true)
    expect(aggregate).not.toHaveBeenCalled()
  })

  it('treats a missing aggregate sum as zero deficit', async () => {
    const aggregate = jest.fn(async () => ({ _sum: { amount: null } }))
    const dbProvider = { getClient: jest.fn(async () => ({ bridgePendingTransfer: { aggregate } })) }
    const service = new BridgeFloatService(dbProvider as never, baseLogger as never)
    expect(await service.getOutstandingDeficit('USDC' as never)).toBe(0)
  })
})

describe('BridgeFloatService.getFloatAsset', () => {
  const corridor = {
    blockchain: 'STELLAR' as never,
    cryptoCurrency: 'USDC' as never,
    targetCurrency: 'BRL' as never,
  }

  const makeWithDefinition = (definition: unknown) => {
    const findUnique = jest.fn(async () => definition)
    const dbProvider = { getClient: jest.fn(async () => ({ flowDefinition: { findUnique } })) }
    return { findUnique, service: new BridgeFloatService(dbProvider as never, baseLogger as never) }
  }

  // The corridor that consumes float is whatever the flow definition bridges —
  // not a hardcoded chain. After the Transfero Ultra migration re-routed every
  // USDC->BRL corridor onto the bridge, a chain-specific predicate stopped
  // guarding them and their exposure ran past the cap.
  it('returns the bridge asset for any corridor whose definition enqueues a bridge leg', async () => {
    const { findUnique, service } = makeWithDefinition({ steps: [{ config: { asset: 'USDC', destNetwork: 'MATIC' } }] })

    expect(await service.getFloatAsset(corridor)).toBe('USDC')
    // Pinned to the payout direction: an onramp corridor for the same asset
    // pair has no bridge leg and must never be matched here.
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        flow_corridor_unique: { ...corridor, direction: FlowDirection.CRYPTO_TO_FIAT },
      },
    }))
  })

  it('returns undefined for a corridor that settles directly without a bridge leg', async () => {
    const { service } = makeWithDefinition({ steps: [] })
    expect(await service.getFloatAsset(corridor)).toBeUndefined()
  })

  it('returns undefined when the corridor has no flow definition', async () => {
    const { service } = makeWithDefinition(null)
    expect(await service.getFloatAsset(corridor)).toBeUndefined()
  })

  it('ignores a bridge step whose config carries no recognisable asset', async () => {
    const { service } = makeWithDefinition({ steps: [{ config: { destNetwork: 'MATIC' } }, { config: { asset: 'NOT_AN_ASSET' } }] })
    expect(await service.getFloatAsset(corridor)).toBeUndefined()
  })
})
