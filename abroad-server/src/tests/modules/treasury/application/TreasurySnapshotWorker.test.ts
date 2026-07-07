import 'reflect-metadata'

import type { ILogger } from '../../../../core/logging/types'

import { TreasurySnapshotWorker } from '../../../../modules/treasury/application/TreasurySnapshotWorker'

const makeLogger = (): ILogger => ({
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
}) as unknown as ILogger

describe('TreasurySnapshotWorker', () => {
  it('captures a snapshot on runOnce and survives a failing tick', async () => {
    const captureSnapshot = jest.fn()
      .mockResolvedValueOnce({ cells: 4, errors: [], skipped: false })
      .mockRejectedValueOnce(new Error('venue exploded'))
    const worker = new TreasurySnapshotWorker({ captureSnapshot } as never, makeLogger())

    await expect(worker.runOnce()).resolves.toBeUndefined()
    await expect(worker.runOnce()).resolves.toBeUndefined()
    expect(captureSnapshot).toHaveBeenCalledTimes(2)
  })

  it('stops promptly mid-sleep instead of waiting out the interval', async () => {
    const captureSnapshot = jest.fn(async () => ({ cells: 1, errors: [], skipped: false }))
    const worker = new TreasurySnapshotWorker(
      { captureSnapshot } as never,
      makeLogger(),
      { pollIntervalMs: 60 * 60 * 1000 },
    )

    worker.start()
    // Let the first tick run and the loop enter its hour-long sleep.
    await new Promise(resolve => setTimeout(resolve, 20))

    const stoppedFast = await Promise.race([
      worker.stop().then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000)),
    ])

    expect(stoppedFast).toBe(true)
    expect(captureSnapshot).toHaveBeenCalledTimes(1)
  })
})
