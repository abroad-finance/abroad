import { Wallet } from '@binance/wallet'

import { BridgeSweepService } from '../../../../modules/treasury/application/BridgeSweepService'

const withdrawMock = jest.fn()
const allCoinsMock = jest.fn()
const withdrawHistoryMock = jest.fn()
jest.mock('@binance/wallet', () => ({
  Wallet: jest.fn().mockImplementation(() => ({
    restAPI: { allCoinsInformation: allCoinsMock, withdraw: withdrawMock, withdrawHistory: withdrawHistoryMock },
  })),
}))
const MockedWallet = Wallet as unknown as jest.Mock

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

type Leg = { amount: number, id: string }

const makeService = (opts: {
  members?: Leg[]
  pending?: Leg[]
  stale?: { destNetwork: string, id: string }
  submitted?: { createdAt?: Date, id: string }[]
} = {}) => {
  const pending = (opts.pending ?? []).map(p => ({ ...p, asset: 'USDC', destNetwork: 'SOL', status: 'PENDING' }))
  // Legs that a submitBatch re-derive (findMany by batchId) sees; defaults to
  // the pending set (the claimed legs), overridable for resume/empty cases.
  const members = (opts.members ?? opts.pending ?? []).map(p => ({ ...p, asset: 'USDC', destNetwork: 'SOL', status: 'BATCHED' }))
  const findMany = jest.fn(async (args?: { where?: { batchId?: string, status?: string } }) =>
    (args?.where?.batchId ? members : pending))
  const updateMany = jest.fn(async () => ({ count: pending.length }))
  const batchCreate = jest.fn(async () => ({ destNetwork: 'SOL', id: 'batch-1' }))
  const batchUpdate = jest.fn(async () => ({}))
  const batchFindFirst = jest.fn(async () => opts.stale ?? null)
  const batchFindMany = jest.fn(async () => opts.submitted ?? [])
  const client: Record<string, unknown> = {
    bridgeBatch: { create: batchCreate, findFirst: batchFindFirst, findMany: batchFindMany, update: batchUpdate },
    bridgePendingTransfer: { findMany, updateMany },
  }
  client.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(client))
  const dbProvider = { getClient: jest.fn(async () => client) }

  const destinationProvider = {
    getDepositNetwork: jest.fn(() => 'SOLANA'),
    getExchangeAddress: jest.fn(async () => ({ address: 'B7Agt8Cc-sol-usdc', memo: null, success: true })),
  }
  const exchangeProviderFactory = {
    getExchangeProvider: jest.fn(() => destinationProvider),
    getExchangeProviderForCapability: jest.fn(() => destinationProvider),
  }
  const secretManager = { getSecret: jest.fn(async () => 'secret'), getSecrets: jest.fn(async () => ({})) }

  const service = new BridgeSweepService(
    dbProvider as never,
    exchangeProviderFactory as never,
    secretManager as never,
    baseLogger as never,
  )
  return { batchCreate, batchUpdate, findMany, service, updateMany }
}

describe('BridgeSweepService.sweep', () => {
  beforeEach(() => {
    withdrawMock.mockReset()
    allCoinsMock.mockReset()
    withdrawHistoryMock.mockReset()
    MockedWallet.mockClear()
    withdrawMock.mockResolvedValue({ data: async () => ({ id: 'wd-1' }) })
    allCoinsMock.mockResolvedValue({
      data: async () => ([{ coin: 'USDC', networkList: [{ network: 'SOL', withdrawFee: '0.3', withdrawMin: '5' }] }]),
    })
  })

  it('does not withdraw when the pooled legs are below the bridge minimum', async () => {
    const { batchCreate, service, updateMany } = makeService({ pending: [{ amount: 0.45, id: 'leg-1' }, { amount: 1.0, id: 'leg-2' }] })
    const result = await service.sweep()
    expect(result.swept).toBe(false)
    expect(result.reason).toBe('below_minimum')
    expect(withdrawMock).not.toHaveBeenCalled()
    expect(batchCreate).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('issues one batched withdrawal (amount re-derived from claimed legs) when the pool clears the minimum', async () => {
    const { batchCreate, batchUpdate, service } = makeService({ pending: [{ amount: 4.0, id: 'leg-1' }, { amount: 3.0, id: 'leg-2' }] })
    const result = await service.sweep()
    expect(result.swept).toBe(true)
    expect(result.amount).toBeCloseTo(7.0, 6)
    expect(batchCreate).toHaveBeenCalled()
    expect(withdrawMock).toHaveBeenCalledWith(expect.objectContaining({ address: 'B7Agt8Cc-sol-usdc', amount: 7.0, coin: 'USDC', network: 'SOL', withdrawOrderId: 'batch-1' }))
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ grossAmount: 7.0, status: 'SUBMITTED', withdrawId: 'wd-1' }) }))
  })

  // The crash-between-create-and-claim case: a batch with no member legs must
  // NOT withdraw its stored grossAmount — it is failed and withdraws nothing.
  it('does not withdraw an empty batch (no member legs); marks it FAILED', async () => {
    const { batchUpdate, service } = makeService({ members: [], pending: [{ amount: 9, id: 'leg-1' }] })
    const result = await service.sweep()
    expect(result.swept).toBe(false)
    expect(result.reason).toBe('no_member_legs')
    expect(withdrawMock).not.toHaveBeenCalled()
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED' } }))
  })

  it('does not withdraw when the Binance minimum is unresolved', async () => {
    allCoinsMock.mockResolvedValue({ data: async () => ([]) })
    const { batchCreate, service } = makeService({ pending: [{ amount: 9, id: 'leg-1' }] })
    const result = await service.sweep()
    expect(result.swept).toBe(false)
    expect(result.reason).toBe('constraints_unavailable')
    expect(withdrawMock).not.toHaveBeenCalled()
    expect(batchCreate).not.toHaveBeenCalled()
  })

  it('resumes a stale OPEN batch idempotently (amount re-derived from its legs) before pooling new legs', async () => {
    const { batchUpdate, findMany, service } = makeService({
      members: [{ amount: 6.5, id: 'leg-old' }],
      pending: [{ amount: 9, id: 'leg-new' }],
      stale: { destNetwork: 'SOL', id: 'batch-open' },
    })
    const result = await service.sweep()
    expect(result.swept).toBe(true)
    expect(result.batchId).toBe('batch-open')
    expect(withdrawMock).toHaveBeenCalledWith(expect.objectContaining({ amount: 6.5, withdrawOrderId: 'batch-open' }))
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }))
    // resumed first; never queried the PENDING pool
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('treats a duplicate-withdrawal rejection as already submitted (no re-withdraw)', async () => {
    withdrawMock.mockRejectedValue({ code: -4034, message: 'Duplicate withdraw order' })
    const { batchUpdate, service } = makeService({ members: [{ amount: 6.5, id: 'leg-old' }], stale: { destNetwork: 'SOL', id: 'batch-open' } })
    const result = await service.sweep()
    expect(result.swept).toBe(true)
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }))
  })

  it('leaves the batch OPEN (retryable) when the withdrawal fails non-duplicately', async () => {
    withdrawMock.mockRejectedValue(new Error('network down'))
    const { batchUpdate, service } = makeService({ members: [{ amount: 6.5, id: 'leg-old' }], stale: { destNetwork: 'SOL', id: 'batch-open' } })
    const result = await service.sweep()
    expect(result.swept).toBe(false)
    expect(result.reason).toBe('withdraw_failed')
    expect(batchUpdate).not.toHaveBeenCalled()
  })

  it('does nothing when there are no pending legs and no stale batch', async () => {
    const { batchCreate, service } = makeService({ pending: [] })
    const result = await service.sweep()
    expect(result.swept).toBe(false)
    expect(batchCreate).not.toHaveBeenCalled()
    expect(withdrawMock).not.toHaveBeenCalled()
  })
})

describe('BridgeSweepService.reconcile', () => {
  beforeEach(() => {
    withdrawHistoryMock.mockReset()
    MockedWallet.mockClear()
  })

  it('marks a completed batch CREDITED and its legs SETTLED', async () => {
    withdrawHistoryMock.mockResolvedValue({ data: async () => ([{ status: 6, withdrawOrderId: 'b-sub' }]) }) // 6 = Completed
    const { batchUpdate, service, updateMany } = makeService({ submitted: [{ createdAt: new Date(), id: 'b-sub' }] })
    const result = await service.reconcile()
    expect(result.credited).toBe(1)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'SETTLED' }, where: { batchId: 'b-sub' } }))
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CREDITED' }), where: { id: 'b-sub' } }))
  })

  it('returns a definitively-failed batch legs to PENDING for re-batching', async () => {
    withdrawHistoryMock.mockResolvedValue({ data: async () => ([{ status: 3, withdrawOrderId: 'b-sub' }]) }) // 3 = Rejected
    const { batchUpdate, service, updateMany } = makeService({ submitted: [{ createdAt: new Date(), id: 'b-sub' }] })
    const result = await service.reconcile()
    expect(result.failed).toBe(1)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { batchId: null, status: 'PENDING' }, where: { batchId: 'b-sub' } }))
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED' }, where: { id: 'b-sub' } }))
  })

  it('leaves an in-progress batch SUBMITTED', async () => {
    withdrawHistoryMock.mockResolvedValue({ data: async () => ([{ status: 4, withdrawOrderId: 'b-sub' }]) }) // 4 = Processing
    const { batchUpdate, service, updateMany } = makeService({ submitted: [{ createdAt: new Date(), id: 'b-sub' }] })
    const result = await service.reconcile()
    expect(result.credited).toBe(0)
    expect(result.failed).toBe(0)
    expect(batchUpdate).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })
})
