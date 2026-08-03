import type { Request, RequestHandler, Response } from 'express'

import { QuoteRequestDirection, QuoteRequestOutcome } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

const quoteDirection = (request: Request): null | QuoteRequestDirection => {
  if (request.method !== 'POST') return null
  if (request.path === '/quote') return QuoteRequestDirection.FORWARD
  if (request.path === '/quote/reverse') return QuoteRequestDirection.REVERSE
  return null
}

/**
 * Persists one PII-free operational fact per quote HTTP request. It runs before
 * TSOA so schema/authentication failures are included, but intentionally never
 * reads or stores the request body, credentials, partner, or response payload.
 */
@injectable()
export class QuoteRequestMetricRecorder {
  private quoteCoverageBoundaryInitialized = false

  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private readonly logger: ILogger,
  ) {}

  public middleware(): RequestHandler {
    return (request, response, next) => {
      const direction = quoteDirection(request)
      if (direction) void this.record(direction, response)
      next()
    }
  }

  private async record(
    direction: QuoteRequestDirection,
    response: Response,
  ): Promise<void> {
    type Completion = { outcome: QuoteRequestOutcome, statusCode: number }
    type Client = Awaited<ReturnType<IDatabaseClientProvider['getClient']>>

    let client: Client | null = null
    let completion: Completion | null = null
    let metricId: null | string = null
    let updateStarted = false
    let responseCompleted = false

    const persistCompletion = (): void => {
      if (!client || !completion || !metricId || updateStarted) return
      updateStarted = true
      void client.quoteRequestMetric.update({
        data: { completedAt: new Date(), ...completion },
        where: { id: metricId },
      }).catch((error: unknown) => {
        this.logger.warn('Quote request metric completion failed', {
          error: error instanceof Error ? error.message : 'unknown_error',
          metricId,
        })
      })
    }

    const finalize = (statusCode: number): void => {
      if (responseCompleted) return
      responseCompleted = true
      completion = {
        outcome: statusCode >= 200 && statusCode < 300
          ? QuoteRequestOutcome.SUCCESS
          : QuoteRequestOutcome.FAILED,
        statusCode,
      }
      persistCompletion()
    }

    response.once('finish', () => finalize(response.statusCode))
    response.once('close', () => finalize(response.writableEnded ? response.statusCode : 499))

    let requestedAt: Date
    try {
      client = await this.dbProvider.getClient()
      requestedAt = new Date()
      const metric = await client.quoteRequestMetric.create({ data: { direction, requestedAt } })
      metricId = metric.id
      persistCompletion()
    }
    catch (error) {
      this.logger.warn('Quote request metric start failed', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
      return
    }

    if (this.quoteCoverageBoundaryInitialized) return
    try {
      await client.businessPerformanceState.updateMany({
        data: { quoteMetricsFrom: requestedAt },
        where: {
          id: 'singleton',
          OR: [
            { quoteMetricsFrom: null },
            { quoteMetricsFrom: { gt: requestedAt } },
          ],
        },
      })
      this.quoteCoverageBoundaryInitialized = true
    }
    catch (error) {
      this.logger.warn('Quote request metric coverage boundary failed', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}
