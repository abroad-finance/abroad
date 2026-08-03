import { ILogger } from '../../../../core/logging/types'
import { BusinessPerformanceReconciliationService } from '../../../../modules/operations/application/BusinessPerformanceReconciliationService'
import { BusinessPerformanceReconciliationWorker } from '../../../../modules/operations/application/BusinessPerformanceReconciliationWorker'

describe('BusinessPerformanceReconciliationWorker', () => {
  const previousBackfillInterval = process.env.BUSINESS_PERFORMANCE_BACKFILL_INTERVAL_MS
  const previousInterval = process.env.BUSINESS_PERFORMANCE_RECONCILE_INTERVAL_MS

  beforeEach(() => {
    jest.useFakeTimers()
    process.env.BUSINESS_PERFORMANCE_BACKFILL_INTERVAL_MS = '1000'
    process.env.BUSINESS_PERFORMANCE_RECONCILE_INTERVAL_MS = '5000'
  })

  afterEach(() => {
    jest.useRealTimers()
    if (previousBackfillInterval === undefined) {
      delete process.env.BUSINESS_PERFORMANCE_BACKFILL_INTERVAL_MS
    }
    else {
      process.env.BUSINESS_PERFORMANCE_BACKFILL_INTERVAL_MS = previousBackfillInterval
    }
    if (previousInterval === undefined) {
      delete process.env.BUSINESS_PERFORMANCE_RECONCILE_INTERVAL_MS
    }
    else {
      process.env.BUSINESS_PERFORMANCE_RECONCILE_INTERVAL_MS = previousInterval
    }
  })

  it('interrupts an active backfill wait during shutdown', async () => {
    const runBatch = jest.fn().mockResolvedValue({ complete: false, processed: 25 })
    const worker = new BusinessPerformanceReconciliationWorker(
      { runBatch } as unknown as BusinessPerformanceReconciliationService,
      { error: jest.fn(), info: jest.fn(), warn: jest.fn() } as ILogger,
    )

    worker.start()
    await jest.advanceTimersByTimeAsync(0)

    expect(runBatch).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
    await expect(worker.stop()).resolves.toBeUndefined()
    expect(jest.getTimerCount()).toBe(0)
  })
})
