import type { ILogger } from '../../../../core/logging/types'

import { OpsConfigurationReleaseService } from '../../../../modules/operations/application/OpsConfigurationReleaseService'
import { OpsConfigurationReleaseWorker } from '../../../../modules/operations/application/OpsConfigurationReleaseWorker'

const buildHarness = () => {
  const applyDue = jest.fn<Promise<number>, []>()
  const logger: jest.Mocked<ILogger> = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  const worker = new OpsConfigurationReleaseWorker(
    { applyDue } as unknown as OpsConfigurationReleaseService,
    logger,
    { pollIntervalMs: 5 },
  )
  return { applyDue, logger, worker }
}

describe('OpsConfigurationReleaseWorker', () => {
  it('applies due releases and records only a bounded aggregate', async () => {
    const { applyDue, logger, worker } = buildHarness()
    applyDue.mockResolvedValue(2)

    await worker.runOnce()

    expect(applyDue).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      '[OpsConfigurationReleaseWorker] Scheduled configuration releases applied',
      { applied: 2 },
    )
  })

  it('contains scan failures so the worker loop can continue', async () => {
    const { applyDue, logger, worker } = buildHarness()
    const failure = new Error('Database temporarily unavailable')
    applyDue.mockRejectedValue(failure)

    await expect(worker.runOnce()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      '[OpsConfigurationReleaseWorker] Scheduled configuration release scan failed',
      failure,
    )
  })
})
