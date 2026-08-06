import 'reflect-metadata'
import { FlowStepType } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { FlowOrchestrator } from '../../../../../modules/flows/application/FlowOrchestrator'
import { ExchangeBalanceUpdatedController } from '../../../../../modules/treasury/interfaces/queue/ExchangeBalanceUpdatedController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

type WaitingStep = { flowInstance: { transactionId: string } }

const createDbProvider = (steps: WaitingStep[] = []): IDatabaseClientProvider => {
  const client = {
    flowStepInstance: {
      findMany: jest.fn(async () => steps),
    },
  }
  return {
    getClient: jest.fn(async () => client),
  } as unknown as IDatabaseClientProvider
}

const buildController = (overrides?: {
  dbProvider?: IDatabaseClientProvider
  logger?: MockLogger
  orchestrator?: jest.Mocked<Pick<FlowOrchestrator, 'handleSignal'>>
  queueHandler?: MockQueueHandler
}) => {
  const logger = overrides?.logger ?? createMockLogger()
  const queueHandler = overrides?.queueHandler ?? createMockQueueHandler()
  const orchestrator = overrides?.orchestrator ?? ({ handleSignal: jest.fn() })
  const dbProvider = overrides?.dbProvider ?? createDbProvider()
  const controller = new ExchangeBalanceUpdatedController(
    logger,
    queueHandler,
    orchestrator as unknown as FlowOrchestrator,
    dbProvider,
  )

  return { controller, dbProvider, logger, orchestrator, queueHandler }
}

describe('ExchangeBalanceUpdatedController', () => {
  it('registers the consumer', () => {
    const { controller, queueHandler } = buildController()

    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.EXCHANGE_BALANCE_UPDATED,
      expect.any(Function),
    )
  })

  it('rejects invalid messages before processing', async () => {
    const { controller, logger, orchestrator } = buildController()
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await expect(runner.onBalanceUpdated({ invalid: true })).rejects.toThrow(/Invalid exchange balance update message/)

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(orchestrator.handleSignal).not.toHaveBeenCalled()
  })

  it('emits a flow signal when the update is valid', async () => {
    const dbProvider = createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }])
    const { controller, orchestrator } = buildController({
      dbProvider,
    })
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await runner.onBalanceUpdated({ provider: 'transfero' })

    const prisma = await dbProvider.getClient()
    expect(prisma.flowStepInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stepType: {
          in: [
            FlowStepType.AWAIT_EXCHANGE_BALANCE,
            FlowStepType.EXCHANGE_CONVERT,
          ],
        },
      }),
    }))
    expect(orchestrator.handleSignal).toHaveBeenCalledWith({
      correlationKeys: { provider: 'transfero' },
      eventType: 'exchange.balance.updated',
      payload: { provider: 'transfero' },
      transactionId: 'tx-1',
    })
  })

  it('honours each step backoff on the speculative sweep but not on an observed webhook', async () => {
    const speculative = createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }])
    const speculativeController = buildController({ dbProvider: speculative })
    const runSpeculative = speculativeController.controller as unknown as {
      onBalanceUpdated: (msg: unknown) => Promise<void>
    }

    await runSpeculative.onBalanceUpdated({ provider: 'transfero', trigger: 'speculative' })

    // The periodic tick is evidence of nothing, so a step that scheduled a
    // later retry stays parked instead of re-reading the provider.
    const speculativePrisma = await speculative.getClient()
    expect(speculativePrisma.flowStepInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ retryAt: null }, { retryAt: { lte: expect.any(Date) } }],
      }),
    }))

    const observed = createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }])
    const observedController = buildController({ dbProvider: observed })
    const runObserved = observedController.controller as unknown as {
      onBalanceUpdated: (msg: unknown) => Promise<void>
    }

    await runObserved.onBalanceUpdated({ provider: 'transfero', trigger: 'observed' })

    // A real balance movement must never be delayed by the backoff.
    const observedPrisma = await observed.getClient()
    expect(observedPrisma.flowStepInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ OR: expect.anything() }),
    }))
    expect(observedController.orchestrator.handleSignal).toHaveBeenCalledTimes(1)
  })

  it('treats a message published without a trigger as observed', async () => {
    const dbProvider = createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }])
    const { controller } = buildController({ dbProvider })
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await runner.onBalanceUpdated({ provider: 'transfero' })

    const prisma = await dbProvider.getClient()
    expect(prisma.flowStepInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ OR: expect.anything() }),
    }))
  })

  it('does not wake conversion steps for Binance balance updates', async () => {
    const dbProvider = createDbProvider()
    const { controller } = buildController({ dbProvider })
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await runner.onBalanceUpdated({ provider: 'binance' })

    const prisma = await dbProvider.getClient()
    expect(prisma.flowStepInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stepType: { in: [FlowStepType.AWAIT_EXCHANGE_BALANCE] },
      }),
    }))
  })

  it('logs when the orchestrator throws', async () => {
    const { controller, logger, orchestrator } = buildController({
      dbProvider: createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }]),
      orchestrator: { handleSignal: jest.fn().mockRejectedValueOnce(new Error('boom')) },
    })
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await expect(runner.onBalanceUpdated({ provider: 'binance' })).rejects.toThrow('boom')

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error processing exchange balance update signal'),
      expect.any(Error),
    )
    expect(orchestrator.handleSignal).toHaveBeenCalledTimes(1)
  })
})
