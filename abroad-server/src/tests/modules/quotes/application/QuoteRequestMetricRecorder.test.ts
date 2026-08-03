import { QuoteRequestDirection, QuoteRequestOutcome } from '@prisma/client'
import { EventEmitter } from 'node:events'

import { ILogger } from '../../../../core/logging/types'
import { QuoteRequestMetricRecorder } from '../../../../modules/quotes/application/QuoteRequestMetricRecorder'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

describe('QuoteRequestMetricRecorder', () => {
  it('never delays the quote route while the metric insert is pending', async () => {
    let resolveClient: ((client: unknown) => void) | undefined
    const create = jest.fn().mockResolvedValue({ id: 'metric-id' })
    const update = jest.fn().mockResolvedValue({})
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const recorder = new QuoteRequestMetricRecorder({
      getClient: jest.fn().mockImplementation(() => new Promise((resolve) => {
        resolveClient = resolve
      })),
    } as unknown as IDatabaseClientProvider, {
      error: jest.fn(), info: jest.fn(), warn: jest.fn(),
    } as ILogger)
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number
      writableEnded: boolean
    }
    response.statusCode = 200
    response.writableEnded = true
    const next = jest.fn()

    recorder.middleware()({ method: 'POST', path: '/quote' } as never, response as never, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    resolveClient?.({
      businessPerformanceState: { updateMany },
      quoteRequestMetric: { create, update },
    })
    await new Promise(resolve => setImmediate(resolve))
    response.emit('finish')
    await new Promise(resolve => setImmediate(resolve))
    expect(update).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: QuoteRequestOutcome.SUCCESS, statusCode: 200 }),
      where: { id: 'metric-id' },
    })
  })

  it('records a failed reverse quote without reading the request payload', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'metric-id' })
    const update = jest.fn().mockResolvedValue({})
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const recorder = new QuoteRequestMetricRecorder({
      getClient: jest.fn().mockResolvedValue({
        businessPerformanceState: { updateMany },
        quoteRequestMetric: { create, update },
      }),
    } as unknown as IDatabaseClientProvider, {
      error: jest.fn(), info: jest.fn(), warn: jest.fn(),
    } as ILogger)
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number
      writableEnded: boolean
    }
    response.statusCode = 400
    response.writableEnded = true
    const next = jest.fn()

    recorder.middleware()({
      body: { tax_id: 'must-not-be-read' },
      method: 'POST',
      path: '/quote/reverse',
    } as never, response as never, next)
    await new Promise(resolve => setImmediate(resolve))
    response.emit('finish')
    await new Promise(resolve => setImmediate(resolve))

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ direction: QuoteRequestDirection.REVERSE }),
    })
    expect(updateMany).toHaveBeenCalledWith({
      data: { quoteMetricsFrom: expect.any(Date) },
      where: {
        id: 'singleton',
        OR: [
          { quoteMetricsFrom: null },
          { quoteMetricsFrom: { gt: expect.any(Date) } },
        ],
      },
    })
    expect(update).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: QuoteRequestOutcome.FAILED, statusCode: 400 }),
      where: { id: 'metric-id' },
    })
    expect(next).toHaveBeenCalledTimes(1)
  })
})
