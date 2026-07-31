import { BridgeSweepWorker } from '../../../../modules/treasury/application/BridgeSweepWorker'
import { QueueName } from '../../../../platform/messaging/queues'

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const makeService = () => ({
  reconcile: jest.fn(async () => ({ credited: 0, failed: 0 })),
  sweep: jest.fn(async () => ({ amount: 7, batchId: 'b1', count: 2, swept: true })),
})

const makeQueueHandler = () => ({
  postMessage: jest.fn(async () => undefined),
})

describe('BridgeSweepWorker', () => {
  it('runOnce reconciles, sweeps, and publishes the periodic Transfero wake-up', async () => {
    const service = makeService()
    const queueHandler = makeQueueHandler()
    const worker = new BridgeSweepWorker(
      service as never,
      queueHandler as never,
      baseLogger as never,
      { pollIntervalMs: 999_999 },
    )

    await worker.runOnce()

    expect(service.reconcile).toHaveBeenCalledTimes(1)
    expect(service.sweep).toHaveBeenCalledTimes(1)
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.EXCHANGE_BALANCE_UPDATED,
      { provider: 'transfero' },
    )
  })

  it('runOnce swallows a failure (never throws out of a tick)', async () => {
    const service = makeService()
    const queueHandler = makeQueueHandler()
    service.reconcile.mockRejectedValue(new Error('boom'))
    const worker = new BridgeSweepWorker(
      service as never,
      queueHandler as never,
      baseLogger as never,
      { pollIntervalMs: 999_999 },
    )

    await expect(worker.runOnce()).resolves.toBeUndefined()
    expect(service.sweep).not.toHaveBeenCalled() // reconcile threw; tick caught it
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.EXCHANGE_BALANCE_UPDATED,
      { provider: 'transfero' },
    )
  })

  it('does not fail the sweep tick when the periodic wake-up cannot be published', async () => {
    const service = makeService()
    const queueHandler = makeQueueHandler()
    queueHandler.postMessage.mockRejectedValueOnce(new Error('queue unavailable'))
    const worker = new BridgeSweepWorker(
      service as never,
      queueHandler as never,
      baseLogger as never,
      { pollIntervalMs: 999_999 },
    )

    await expect(worker.runOnce()).resolves.toBeUndefined()
    expect(service.reconcile).toHaveBeenCalledTimes(1)
    expect(service.sweep).toHaveBeenCalledTimes(1)
    expect(baseLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unable to publish periodic Transfero reconciliation signal'),
      expect.any(Error),
    )
  })
})
