import { inject } from 'inversify'
import { Controller, Get, Route, SuccessResponse } from 'tsoa'

import type { TransparencyMetricsResponse } from '../../application/transparencyContracts'

import { TransparencyMetricsService } from '../../application/TransparencyMetricsService'

@Route('public/transparency')
export class TransparencyMetricsController extends Controller {
  public constructor(
    @inject(TransparencyMetricsService)
    private readonly metricsService: TransparencyMetricsService,
  ) {
    super()
  }

  @Get()
  @SuccessResponse('200', 'Current public transparency metrics retrieved')
  public async getMetrics(): Promise<TransparencyMetricsResponse> {
    this.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
    return this.metricsService.getMetrics()
  }
}
