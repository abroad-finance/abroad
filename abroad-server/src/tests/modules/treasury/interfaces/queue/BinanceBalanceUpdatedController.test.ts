import 'reflect-metadata'

import { FlowOrchestrator } from '../../../../../modules/flows/application/FlowOrchestrator'
import { BinanceBalanceUpdatedController } from '../../../../../modules/treasury/interfaces/queue/BinanceBalanceUpdatedController'
import { QueueName } from '../../../../../platform/messaging/queues'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

type WaitingStep = { flowInstance: { transactionId: string } }

const createDbProvider = (steps: WaitingStep[] = []): IDatabaseClientProvider => ({
  getClient: jest.fn(async () => ({
    flowStepInstance: {
      findMany: jest.fn(async () => steps),
    },
  })),
}) as IDatabaseClientProvider

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
  const controller = new BinanceBalanceUpdatedController(
    logger,
    queueHandler,
    orchestrator as FlowOrchestrator,
    dbProvider,
  )

  return { controller, dbProvider, logger, orchestrator, queueHandler }
}

describe('BinanceBalanceUpdatedController', () => {
  it('registers the consumer', () => {
    const { controller, queueHandler } = buildController()

    controller.registerConsumers()

    expect(queueHandler.subscribeToQueue).toHaveBeenCalledWith(
      QueueName.BINANCE_BALANCE_UPDATED,
      expect.any(Function),
    )
  })

  it('rejects invalid messages before processing', async () => {
    const { controller, logger, orchestrator } = buildController()
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await expect(runner.onBalanceUpdated({ invalid: true })).rejects.toThrow(/Invalid binance balance update message/)

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(orchestrator.handleSignal).not.toHaveBeenCalled()
  })

  it('emits a flow signal when the balance update is valid', async () => {
    const { controller, orchestrator } = buildController({
      dbProvider: createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }]),
    })
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await runner.onBalanceUpdated({})

    expect(orchestrator.handleSignal).toHaveBeenCalledWith({
      correlationKeys: { provider: 'binance' },
      eventType: 'exchange.balance.updated',
      payload: { provider: 'binance' },
      transactionId: 'tx-1',
    })
  })

  it('logs when the orchestrator throws', async () => {
    const { controller, logger, orchestrator } = buildController({
      dbProvider: createDbProvider([{ flowInstance: { transactionId: 'tx-1' } }]),
      orchestrator: { handleSignal: jest.fn().mockRejectedValueOnce(new Error('boom')) },
    })
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await expect(runner.onBalanceUpdated({})).rejects.toThrow('boom')

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error processing balance update signal'),
      expect.any(Error),
    )
    expect(orchestrator.handleSignal).toHaveBeenCalledTimes(1)
  })
})
