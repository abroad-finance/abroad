import { inject } from 'inversify'
import {
  Controller,
  Get,
  OperationId,
  Query,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'
import { z } from 'zod'

import { ValidationError } from '../../../../core/errors'
import { OpsBusinessPerformanceService } from '../../application/OpsBusinessPerformanceService'
import { OpsBusinessPerformanceRange, OpsBusinessPerformanceResponse } from '../../application/OpsBusinessPerformanceTypes'

const utcIsoTimestampSchema = z.string().datetime({ offset: false })
const MAX_RANGE_DURATION_MS = 366 * 24 * 60 * 60_000

const reportRangeSchema = z.object({
  comparisonFrom: utcIsoTimestampSchema.optional(),
  comparisonTo: utcIsoTimestampSchema.optional(),
  from: utcIsoTimestampSchema,
  to: utcIsoTimestampSchema,
}).superRefine((value, context) => {
  if ((value.comparisonFrom === undefined) !== (value.comparisonTo === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'comparisonFrom and comparisonTo must be supplied together',
      path: ['comparisonFrom'],
    })
  }
})

const toRange = (from: string, to: string): OpsBusinessPerformanceRange => {
  const range = { from: new Date(from), to: new Date(to) }
  if (range.from >= range.to) {
    throw new ValidationError('Range from must be earlier than range to')
  }
  if (range.to.getTime() - range.from.getTime() > MAX_RANGE_DURATION_MS) {
    throw new ValidationError('Business performance ranges cannot exceed 366 days')
  }
  return range
}

@Route('ops/business-performance')
@Security('OpsAuth', ['overview:read'])
export class OpsBusinessPerformanceController extends Controller {
  public constructor(
    @inject(OpsBusinessPerformanceService)
    private readonly service: OpsBusinessPerformanceService,
  ) {
    super()
  }

  @Get()
  @OperationId('OpsGetBusinessPerformance')
  @SuccessResponse('200', 'Business performance retrieved')
  public async getBusinessPerformance(
    @Query() from: string,
    @Query() to: string,
    @Query() comparisonFrom?: string,
    @Query() comparisonTo?: string,
  ): Promise<OpsBusinessPerformanceResponse> {
    const parsedResult = reportRangeSchema.safeParse({ comparisonFrom, comparisonTo, from, to })
    if (!parsedResult.success) {
      throw new ValidationError('Business performance ranges must be UTC ISO timestamps', {
        issues: parsedResult.error.issues.map(issue => ({ message: issue.message, path: issue.path })),
      })
    }
    const parsed = parsedResult.data
    const primary = toRange(parsed.from, parsed.to)
    const durationMs = primary.to.getTime() - primary.from.getTime()
    const comparison = parsed.comparisonFrom && parsed.comparisonTo
      ? toRange(parsed.comparisonFrom, parsed.comparisonTo)
      : {
          from: new Date(primary.from.getTime() - durationMs),
          to: primary.from,
        }
    return this.service.getReport({ comparison, primary })
  }
}
