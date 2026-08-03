import { ValidationError } from '../../../../../core/errors'
import { OpsBusinessPerformanceService } from '../../../../../modules/operations/application/OpsBusinessPerformanceService'
import { OpsBusinessPerformanceController } from '../../../../../modules/operations/interfaces/http/OpsBusinessPerformanceController'

describe('OpsBusinessPerformanceController', () => {
  const report = { metrics: [] }
  const getReport = jest.fn().mockResolvedValue(report)
  const controller = new OpsBusinessPerformanceController({ getReport } as unknown as OpsBusinessPerformanceService)

  beforeEach(() => {
    getReport.mockClear()
  })

  it('derives the immediately preceding equal-duration UTC comparison', async () => {
    await expect(controller.getBusinessPerformance(
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
    )).resolves.toBe(report)

    expect(getReport).toHaveBeenCalledWith({
      comparison: {
        from: new Date('2026-07-31T00:00:00.000Z'),
        to: new Date('2026-08-01T00:00:00.000Z'),
      },
      primary: {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-02T00:00:00.000Z'),
      },
    })
  })

  it('accepts a custom comparison with a different duration', async () => {
    await controller.getBusinessPerformance(
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      '2026-07-08T00:00:00.000Z',
    )

    expect(getReport).toHaveBeenCalledWith(expect.objectContaining({
      comparison: {
        from: new Date('2026-07-01T00:00:00.000Z'),
        to: new Date('2026-07-08T00:00:00.000Z'),
      },
    }))
  })

  it.each([
    ['local timestamp', '2026-08-01T00:00:00', '2026-08-02T00:00:00.000Z', undefined, undefined],
    ['non-positive range', '2026-08-02T00:00:00.000Z', '2026-08-01T00:00:00.000Z', undefined, undefined],
    ['partial comparison', '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', '2026-07-01T00:00:00.000Z', undefined],
    ['excessive range', '2025-01-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', undefined, undefined],
  ])('rejects %s', async (_case, from, to, comparisonFrom, comparisonTo) => {
    await expect(controller.getBusinessPerformance(
      from,
      to,
      comparisonFrom,
      comparisonTo,
    )).rejects.toBeInstanceOf(ValidationError)
  })
})
