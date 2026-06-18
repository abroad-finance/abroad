import { BridgeSweepWorker } from '../../../../modules/treasury/application/BridgeSweepWorker'

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const makeService = () => ({
  reconcile: jest.fn(async () => ({ credited: 0, failed: 0 })),
  sweep: jest.fn(async () => ({ amount: 7, batchId: 'b1', count: 2, swept: true })),
})

describe('BridgeSweepWorker', () => {
  it('runOnce reconciles then sweeps', async () => {
    const service = makeService()
    const worker = new BridgeSweepWorker(service as never, baseLogger as never, { pollIntervalMs: 999_999 })

    await worker.runOnce()

    expect(service.reconcile).toHaveBeenCalledTimes(1)
    expect(service.sweep).toHaveBeenCalledTimes(1)
  })

  it('runOnce swallows a failure (never throws out of a tick)', async () => {
    const service = makeService()
    service.reconcile.mockRejectedValue(new Error('boom'))
    const worker = new BridgeSweepWorker(service as never, baseLogger as never, { pollIntervalMs: 999_999 })

    await expect(worker.runOnce()).resolves.toBeUndefined()
    expect(service.sweep).not.toHaveBeenCalled() // reconcile threw; tick caught it
  })
})
