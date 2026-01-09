import 'reflect-metadata'
import { OutboxStatus } from '@prisma/client'

import { OutboxWorker } from '../../../platform/outbox/OutboxWorker'

describe('OutboxWorker', () => {
  it('delivers pending records on runOnce', async () => {
    const repository = {
      nextBatch: jest.fn(async () => [
        {
          attempts: 0,
          availableAt: new Date(),
          createdAt: new Date(),
          id: '1',
          lastError: null,
          payload: {},
          status: OutboxStatus.PENDING,
          type: 'queue',
          updatedAt: new Date(),
        },
      ]),
      summarizeFailures: jest.fn(async () => ({ delivering: 0, failed: 0 })),
    }
    const dispatcher = {
      deliver: jest.fn(async () => undefined),
      enqueueSlack: jest.fn(),
    }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

    const worker = new OutboxWorker(repository as never, dispatcher as never, logger as never, { batchSize: 10 })
    await worker.runOnce()

    expect(repository.nextBatch).toHaveBeenCalledWith(10)
    expect(dispatcher.deliver).toHaveBeenCalled()
  })

  it('starts a loop and can be stopped', async () => {
    const repository = {
      nextBatch: jest.fn(async () => []),
      summarizeFailures: jest.fn(async () => ({ delivering: 0, failed: 0 })),
    }
    const dispatcher = { deliver: jest.fn(), enqueueSlack: jest.fn() }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

    const worker = new OutboxWorker(
      repository as never,
      dispatcher as never,
      logger as never,
      { pollIntervalMs: 10, slackOnFailure: false },
    )
    worker.start()
    await new Promise(resolve => setTimeout(resolve, 25))
    await worker.stop()

    expect(repository.nextBatch).toHaveBeenCalled()
  })

  it('sends slack alert when failures accumulate', async () => {
    const repository = {
      nextBatch: jest.fn(async () => []),
      summarizeFailures: jest.fn(async () => ({ delivering: 1, failed: 2 })),
    }
    const dispatcher = { deliver: jest.fn(), enqueueSlack: jest.fn(async () => undefined) }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

    const worker = new OutboxWorker(repository as never, dispatcher as never, logger as never, { pollIntervalMs: 10 })
    await worker.runOnce()
    await worker.reportFailures()

    expect(logger.warn).toHaveBeenCalledWith('[OutboxWorker] Outbox failure backlog detected', { delivering: 1, failed: 2 })
    expect(dispatcher.enqueueSlack).toHaveBeenCalledWith(
      expect.stringContaining('Failed: 2'),
      'outbox-worker',
    )
  })

  it('throttles repeated failure alerts', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const repository = {
      nextBatch: jest.fn(async () => []),
      summarizeFailures: jest.fn(async () => ({ delivering: 1, failed: 1 })),
    }
    const dispatcher = { deliver: jest.fn(), enqueueSlack: jest.fn(async () => undefined) }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

    const worker = new OutboxWorker(repository as never, dispatcher as never, logger as never, { slackOnFailure: true })
    await worker.reportFailures()
    await worker.reportFailures()

    expect(dispatcher.enqueueSlack).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  it('logs delivery failures and continues processing', async () => {
    const failingRecord = {
      attempts: 0,
      availableAt: new Date(),
      createdAt: new Date(),
      id: '1',
      lastError: null,
      payload: {},
      status: OutboxStatus.PENDING,
      type: 'queue',
      updatedAt: new Date(),
    }
    const repository = {
      nextBatch: jest.fn(async () => [failingRecord]),
      summarizeFailures: jest.fn(async () => ({ delivering: 0, failed: 0 })),
    }
    const dispatcher = {
      deliver: jest.fn(async () => {
        throw new Error('dispatch failed')
      }),
      enqueueSlack: jest.fn(),
    }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

    const worker = new OutboxWorker(repository as never, dispatcher as never, logger as never, { batchSize: 1 })
    await worker.runOnce()

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed delivering outbox record'),
      expect.objectContaining({ recordId: '1' }),
    )
  })
})
