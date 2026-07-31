import { FlowInstanceStatus, FlowStepStatus, FlowStepType, Prisma } from '@prisma/client'

import { FlowRetryWorker } from '../../../../modules/flows/application/FlowRetryWorker'
import { createMockLogger } from '../../../setup/mockFactories'

const NOW = new Date('2026-07-31T12:00:00.000Z')

type RetryCandidate = {
  attempts: number
  flowInstanceId: string
  id: string
  maxAttempts: number
  retryAt: Date | null
  status: FlowStepStatus
  stepOrder: number
}

const dueCandidate: RetryCandidate = {
  attempts: 1,
  flowInstanceId: 'flow-1',
  id: 'step-1',
  maxAttempts: 3,
  retryAt: new Date('2026-07-31T11:59:00.000Z'),
  status: FlowStepStatus.WAITING,
  stepOrder: 1,
}

const createHarness = (candidates: RetryCandidate[] = [dueCandidate]) => {
  const transactionClient = {
    flowInstance: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    flowStepInstance: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  }
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof transactionClient) => Promise<boolean>) => callback(transactionClient)),
    flowStepInstance: {
      findMany: jest.fn(async () => candidates),
    },
  }
  const orchestrator = { run: jest.fn(async () => undefined) }
  const logger = createMockLogger()
  const worker = new FlowRetryWorker(
    { getClient: jest.fn(async () => prisma) } as never,
    orchestrator as never,
    logger,
    { batchSize: 10, pollIntervalMs: 1 },
  )

  return { logger, orchestrator, prisma, transactionClient, worker }
}

describe('FlowRetryWorker', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('conditionally activates a due payout retry and re-enters the locked orchestrator', async () => {
    const { orchestrator, prisma, transactionClient, worker } = createHarness()

    await worker.runOnce(NOW)

    expect(prisma.flowStepInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 10,
      where: expect.objectContaining({ stepType: FlowStepType.PAYOUT_SEND }),
    }))
    expect(transactionClient.flowInstance.updateMany).toHaveBeenCalledWith({
      data: { currentStepOrder: 1, status: FlowInstanceStatus.IN_PROGRESS },
      where: {
        id: 'flow-1',
        status: {
          in: [
            FlowInstanceStatus.IN_PROGRESS,
            FlowInstanceStatus.NOT_STARTED,
            FlowInstanceStatus.WAITING,
          ],
        },
      },
    })
    expect(transactionClient.flowStepInstance.updateMany).toHaveBeenCalledWith({
      data: { correlation: Prisma.DbNull, retryAt: null, status: FlowStepStatus.READY },
      where: {
        attempts: 1,
        id: 'step-1',
        maxAttempts: 3,
        retryAt: { lte: NOW },
        status: FlowStepStatus.WAITING,
        stepType: FlowStepType.PAYOUT_SEND,
      },
    })
    expect(orchestrator.run).toHaveBeenCalledWith('flow-1')
  })

  it('does not execute when another worker won the conditional step activation', async () => {
    const { orchestrator, transactionClient, worker } = createHarness()
    transactionClient.flowStepInstance.updateMany.mockResolvedValueOnce({ count: 0 })

    await worker.runOnce(NOW)

    expect(orchestrator.run).not.toHaveBeenCalled()
  })

  it('recovers an already-ready payout step after an activation/run crash window', async () => {
    const readyCandidate = {
      ...dueCandidate,
      retryAt: null,
      status: FlowStepStatus.READY,
    }
    const { orchestrator, prisma, worker } = createHarness([readyCandidate])

    await worker.runOnce(NOW)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(orchestrator.run).toHaveBeenCalledWith('flow-1')
  })

  it('rejects an invalid waiting step that has already exhausted its attempts', async () => {
    const exhaustedCandidate = { ...dueCandidate, attempts: 3 }
    const { logger, orchestrator, prisma, worker } = createHarness([exhaustedCandidate])

    await worker.runOnce(NOW)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(orchestrator.run).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid due payout retry state'), expect.objectContaining({
      attempts: 3,
      maxAttempts: 3,
    }))
  })

  it('does not execute an exhausted ready payout step recovered from an invalid state', async () => {
    const exhaustedReadyCandidate = {
      ...dueCandidate,
      attempts: 3,
      retryAt: null,
      status: FlowStepStatus.READY,
    }
    const { logger, orchestrator, prisma, worker } = createHarness([exhaustedReadyCandidate])

    await worker.runOnce(NOW)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(orchestrator.run).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid due payout retry state'), expect.objectContaining({
      attempts: 3,
      maxAttempts: 3,
    }))
  })

  it('deduplicates multiple runnable payout candidates for the same flow', async () => {
    const { orchestrator, worker } = createHarness([
      dueCandidate,
      { ...dueCandidate, id: 'step-duplicate' },
    ])

    await worker.runOnce(NOW)

    expect(orchestrator.run).toHaveBeenCalledTimes(1)
  })

  it('interrupts its sleep and stops promptly', async () => {
    jest.useFakeTimers()
    const { worker } = createHarness([])

    worker.start()
    await Promise.resolve()
    const stopping = worker.stop()
    await jest.runAllTimersAsync()

    await expect(stopping).resolves.toBeUndefined()
  })
})
