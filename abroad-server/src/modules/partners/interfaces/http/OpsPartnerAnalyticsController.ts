import { inject } from 'inversify'
import {
  Controller,
  Get,
  OperationId,
  Path,
  Query,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import {
  OPS_PARTNER_ANALYTICS_RANGES,
  OpsPartnerActivityFilter,
  OpsPartnerAnalyticsNotFoundError,
  OpsPartnerAnalyticsRange,
  OpsPartnerAnalyticsService,
  OpsPartnerDirectoryResponse,
  OpsPartnerLifecycleFilter,
  OpsPartnerScorecard,
} from '../../application/OpsPartnerAnalyticsService'

const directorySchema = z.object({
  activity: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  country: z.string().trim().min(2).max(3).optional(),
  lifecycle: z.enum(['LIVE', 'NO_CREDENTIALS', 'ONBOARDING']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().min(1).max(120).optional(),
  range: z.enum(OPS_PARTNER_ANALYTICS_RANGES).default('30d'),
})

const scorecardSchema = z.object({
  partnerId: z.string().uuid(),
  range: z.enum(OPS_PARTNER_ANALYTICS_RANGES).default('30d'),
})

@Route('ops/partner-analytics')
export class OpsPartnerAnalyticsController extends Controller {
  public constructor(
    @inject(OpsPartnerAnalyticsService)
    private readonly analyticsService: OpsPartnerAnalyticsService,
  ) {
    super()
  }

  @Get('{partnerId}')
  @OperationId('GetOpsPartnerScorecard')
  @Response<400, { reason: string }>(400, 'Bad request')
  @Response<404, { reason: string }>(404, 'Not found')
  @Security('OpsAuth', ['partners:read'])
  @SuccessResponse('200', 'Partner scorecard retrieved')
  public async getScorecard(
    @Path() partnerId: string,
    @Query() range: OpsPartnerAnalyticsRange = '30d',
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsPartnerScorecard> {
    const parsed = scorecardSchema.safeParse({ partnerId, range })
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.issues[0]?.message ?? 'Invalid partner scorecard request' })
    }
    try {
      return await this.analyticsService.getScorecard(parsed.data.partnerId, parsed.data.range)
    }
    catch (error) {
      if (error instanceof OpsPartnerAnalyticsNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get()
  @OperationId('ListOpsPartnerDirectory')
  @Response<400, { reason: string }>(400, 'Bad request')
  @Security('OpsAuth', ['partners:read'])
  @SuccessResponse('200', 'Partner directory retrieved')
  public async listDirectory(
    @Query() range: OpsPartnerAnalyticsRange = '30d',
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Query() query?: string,
    @Query() country?: string,
    @Query() lifecycle?: OpsPartnerLifecycleFilter,
    @Query() activity?: OpsPartnerActivityFilter,
  ): Promise<OpsPartnerDirectoryResponse> {
    const parsed = directorySchema.safeParse({
      activity,
      country,
      lifecycle,
      page,
      pageSize,
      query,
      range,
    })
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.issues[0]?.message ?? 'Invalid partner filters' })
    }
    return this.analyticsService.listDirectory(parsed.data)
  }
}
