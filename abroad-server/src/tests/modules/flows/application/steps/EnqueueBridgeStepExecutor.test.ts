import { EnqueueBridgeStepExecutor } from '../../../../../modules/flows/application/steps/EnqueueBridgeStepExecutor'

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const makeExecutor = () => {
  const upsert = jest.fn(async () => ({}))
  const dbProvider = { getClient: jest.fn(async () => ({ bridgePendingTransfer: { upsert } })) }
  const executor = new EnqueueBridgeStepExecutor(dbProvider as never, baseLogger as never)
  return { executor, upsert }
}

describe('EnqueueBridgeStepExecutor', () => {
  // The user-facing flow has already settled (convert against the float); this
  // step only records the USDC owed to the bridge pool. It must succeed without
  // any external call (so it can't hit the 5-USDC withdrawal floor) and be
  // idempotent on (transactionId, stepOrder).
  it('records a PENDING bridge leg keyed idempotently on (transactionId, stepOrder)', async () => {
    const { executor, upsert } = makeExecutor()

    const result = await executor.execute({
      config: { asset: 'USDC', destNetwork: 'SOL' },
      runtime: { context: { sourceAmount: 0.45, transactionId: 'tx-1' }, stepOutputs: new Map() } as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('succeeded')
    expect(result.output).toMatchObject({ amount: 0.45, asset: 'USDC', bridged: false, destNetwork: 'SOL' })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ amount: 0.45, asset: 'USDC', destNetwork: 'SOL', stepOrder: 6, transactionId: 'tx-1' }),
      update: {},
      where: { transactionId_stepOrder: { stepOrder: 6, transactionId: 'tx-1' } },
    }))
  })

  it('records the realized amount wired from a prior step output (amountSource)', async () => {
    const { executor, upsert } = makeExecutor()

    const result = await executor.execute({
      config: { amountSource: { field: 'amount', kind: 'step', stepOrder: 3 }, asset: 'USDC', destNetwork: 'SOL' },
      runtime: { context: { sourceAmount: 999, transactionId: 'tx-1' }, stepOutputs: new Map([[3, { amount: 0.45 }]]) } as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('succeeded')
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ amount: 0.45 }) }))
  })

  it('fails without recording when the amount is not positive', async () => {
    const { executor, upsert } = makeExecutor()

    const result = await executor.execute({
      config: { asset: 'USDC', destNetwork: 'SOL' },
      runtime: { context: { sourceAmount: 0, transactionId: 'tx-1' }, stepOutputs: new Map() } as never,
      stepOrder: 6,
    })

    expect(result.outcome).toBe('failed')
    expect(upsert).not.toHaveBeenCalled()
  })
})
