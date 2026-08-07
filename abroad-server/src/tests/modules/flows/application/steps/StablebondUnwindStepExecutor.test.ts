import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, FlowStepType, Prisma } from '@prisma/client'

import type { StablebondExecutionOutcome } from '../../../../../modules/treasury/application/JustInTimeUnwindService'

import { StablebondUnwindStepExecutor } from '../../../../../modules/flows/application/steps/StablebondUnwindStepExecutor'
import { createMockLogger } from '../../../../setup/mockFactories'

const runtime = {
  context: {
    blockchain: BlockchainNetwork.STELLAR,
    cryptoCurrency: CryptoCurrency.USDC,
    sourceAmount: 100,
    transactionId: 'transaction-1',
  },
  stepOutputs: new Map<number, Record<string, unknown>>(),
}

const confirmed: StablebondExecutionOutcome = {
  executionId: 'execution-1',
  onChainId: 'hash-1',
  outcome: 'confirmed',
  receivedAmount: new Prisma.Decimal('40.2'),
  spreadBps: 5,
}

const makeExecutor = (options: {
  available?: number
  enabled?: boolean
  inventoryFails?: boolean
  unwind?: StablebondExecutionOutcome
} = {}) => {
  const unwindService = {
    isEnabled: jest.fn(() => options.enabled ?? true),
    unwind: jest.fn(async (args: { idempotencyKey: string, requiredUsdc: Prisma.Decimal }) => {
      void args
      return options.unwind ?? confirmed
    }),
  }
  const inventoryService = {
    getAvailable: jest.fn(async () => (options.inventoryFails
      ? { reason: 'horizon_unreachable', success: false as const }
      : { available: options.available ?? 60, success: true as const })),
  }

  const executor = new StablebondUnwindStepExecutor(
    unwindService as never,
    inventoryService as never,
    createMockLogger(),
  )
  return { executor, inventoryService, unwindService }
}

const run = (executor: StablebondUnwindStepExecutor) => executor.execute({
  config: {},
  runtime: runtime as never,
  stepOrder: 2,
})

describe('StablebondUnwindStepExecutor', () => {
  it('declares the step type the flow definitions reference', () => {
    const { executor } = makeExecutor()
    expect(executor.stepType).toBe(FlowStepType.STABLEBOND_UNWIND)
  })

  it('converts only the shortfall, not the whole delivery', async () => {
    // 100 to deliver against 60 held: sell 40, leave the rest earning.
    const { executor, unwindService } = makeExecutor({ available: 60 })

    const result = await run(executor)

    expect(result.outcome).toBe('succeeded')
    expect(unwindService.unwind.mock.calls.at(0)?.[0].requiredUsdc.toFixed()).toBe('40')
  })

  it('is a no-op when liquid inventory already covers the delivery', async () => {
    const { executor, unwindService } = makeExecutor({ available: 150 })

    expect(await run(executor)).toEqual({
      outcome: 'succeeded',
      output: { reason: 'inventory_sufficient', unwound: false },
    })
    // An ordinary delivery must pay no spread and touch no venue.
    expect(unwindService.unwind).not.toHaveBeenCalled()
  })

  // Ship-dark: a flow definition carrying this step must keep delivering while
  // the position is switched off.
  it('is a no-op when the position is disabled, without reading inventory', async () => {
    const { executor, inventoryService, unwindService } = makeExecutor({ enabled: false })

    expect(await run(executor)).toEqual({
      outcome: 'succeeded',
      output: { reason: 'position_disabled', unwound: false },
    })
    expect(inventoryService.getAvailable).not.toHaveBeenCalled()
    expect(unwindService.unwind).not.toHaveBeenCalled()
  })

  it('reads inventory fresh, because a stale read would under-convert', async () => {
    const { executor, inventoryService } = makeExecutor({ available: 60 })
    await run(executor)

    expect(inventoryService.getAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ bypassCache: true }),
    )
  })

  it('keys the unwind on the transaction and step, so a retry cannot sell twice', async () => {
    const { executor, unwindService } = makeExecutor({ available: 60 })
    await run(executor)

    expect(unwindService.unwind).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'flow:transaction-1:2',
    }))
  })

  it('reports what it sold and what the spread cost', async () => {
    const { executor } = makeExecutor({ available: 60 })

    expect(await run(executor)).toEqual({
      outcome: 'succeeded',
      output: {
        receivedAmount: 40.2, shortfall: 40, spreadBps: 5, unwound: true,
      },
    })
  })

  // An unreadable balance cannot size the shortfall, so there is nothing safe
  // to convert. Failing keeps the delivery from going out under-funded.
  it('fails rather than guessing when inventory is unreadable', async () => {
    const { executor, unwindService } = makeExecutor({ inventoryFails: true })

    expect(await run(executor)).toEqual({
      error: 'inventory_unreadable:horizon_unreachable',
      outcome: 'failed',
    })
    expect(unwindService.unwind).not.toHaveBeenCalled()
  })

  it('fails the step rather than delivering short when the unwind is refused', async () => {
    const { executor } = makeExecutor({
      available: 60,
      unwind: { outcome: 'refused', reason: 'slippage_bound_exceeded' },
    })

    expect(await run(executor)).toEqual({
      error: 'unwind_refused:slippage_bound_exceeded',
      outcome: 'failed',
    })
  })

  // A retry is the intended recovery: the idempotency key re-attaches to the
  // existing execution and reconciles it read-only instead of re-selling.
  it('fails an ambiguous unwind so it is reconciled, never delivered against', async () => {
    const { executor } = makeExecutor({
      available: 60,
      unwind: {
        executionId: 'execution-1',
        onChainId: 'hash-1',
        outcome: 'ambiguous',
        reason: 'stellar_submission_ambiguous',
      },
    })

    expect(await run(executor)).toEqual({
      error: 'unwind_ambiguous:stellar_submission_ambiguous',
      outcome: 'failed',
    })
  })

  it('refuses a flow with no transaction identity to key on', async () => {
    const { executor } = makeExecutor()

    const result = await executor.execute({
      config: {},
      runtime: { ...runtime, context: { ...runtime.context, transactionId: '' } } as never,
      stepOrder: 2,
    })

    expect(result).toEqual({ error: 'Stablebond unwind requires a transactionId', outcome: 'failed' })
  })

  it('rejects a malformed step config', async () => {
    const { executor } = makeExecutor()

    const result = await executor.execute({
      config: { amountSource: { kind: 'nonsense' } },
      runtime: runtime as never,
      stepOrder: 2,
    })

    expect(result.outcome).toBe('failed')
  })
})
