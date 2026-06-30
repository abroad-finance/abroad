import { FlowInstanceStatus } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Query,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import {
  FlowAuditService,
  FlowBulkRetryResult,
  FlowInstanceDetailDto,
  FlowInstanceListResponse,
  FlowInstanceNotFoundError,
  FlowStepActionError,
  FlowStepInstanceDto,
  FlowStepNotFoundError,
} from '../../application/FlowAuditService'

export type FlowBulkRetryRequest = {
  flowInstanceIds: string[]
}

export type FlowBulkRetryResponse = {
  failed: number
  results: FlowBulkRetryResult[]
  succeeded: number
}

const BULK_RETRY_MAX = 200

@Route('ops/flows/instances')
@Security('OpsApiKeyAuth')
export class FlowInstanceController extends Controller {
  constructor(
    @inject(FlowAuditService) private readonly auditService: FlowAuditService,
  ) {
    super()
  }

  /**
   * Resume many stalled flow instances at once, returning a per-instance outcome.
   */
  @Post('bulk-retry')
  @Response<400, { reason: string }>(400, 'Bad Request')
  public async bulkRetry(
    @Body() body: FlowBulkRetryRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<FlowBulkRetryResponse> {
    const flowInstanceIds = body?.flowInstanceIds ?? []
    if (flowInstanceIds.length === 0) {
      return badRequest(400, { reason: 'flowInstanceIds must not be empty' })
    }
    if (flowInstanceIds.length > BULK_RETRY_MAX) {
      return badRequest(400, { reason: `Cannot bulk-retry more than ${BULK_RETRY_MAX} instances at once` })
    }

    const results = await this.auditService.bulkRetry(flowInstanceIds)
    return {
      failed: results.filter(result => !result.ok).length,
      results,
      succeeded: results.filter(result => result.ok).length,
    }
  }

  @Get('{flowInstanceId}')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async getInstance(
    @Path() flowInstanceId: string,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<FlowInstanceDetailDto> {
    try {
      return await this.auditService.getInstance(flowInstanceId)
    }
    catch (error) {
      if (error instanceof FlowInstanceNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get()
  @SuccessResponse('200', 'Flow instances retrieved')
  public async list(
    @Query() status?: FlowInstanceStatus,
    @Query() transactionId?: string,
    @Query() onChainId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() stuckMinutes?: number,
  ): Promise<FlowInstanceListResponse> {
    return this.auditService.list({
      onChainId,
      page,
      pageSize,
      status,
      stuckMinutes,
      transactionId,
    })
  }

  @Post('{flowInstanceId}/steps/{stepInstanceId}/requeue')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async requeueStep(
    @Path() flowInstanceId: string,
    @Path() stepInstanceId: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.auditService.resetStep(flowInstanceId, stepInstanceId, 'requeue')
    }
    catch (error) {
      if (error instanceof FlowStepNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof FlowStepActionError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  /**
   * Resume a stalled flow instance by retrying its earliest FAILED step.
   */
  @Post('{flowInstanceId}/resume')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async resume(
    @Path() flowInstanceId: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.auditService.resumeInstance(flowInstanceId)
    }
    catch (error) {
      if (error instanceof FlowInstanceNotFoundError || error instanceof FlowStepNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof FlowStepActionError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  /**
   * Retry a FAILED step. When `force=true`, also permits a stuck RUNNING step
   * to be re-queued — dangerous for non-idempotent money steps (double execution
   * risk), so the caller must opt in explicitly.
   */
  @Post('{flowInstanceId}/steps/{stepInstanceId}/retry')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async retryStep(
    @Path() flowInstanceId: string,
    @Path() stepInstanceId: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
    @Query() force?: boolean,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.auditService.resetStep(flowInstanceId, stepInstanceId, 'retry', { force: force === true })
    }
    catch (error) {
      if (error instanceof FlowStepNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof FlowStepActionError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
