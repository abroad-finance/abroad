import { inject } from 'inversify'
import {
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
  FlowInstanceDetailDto,
  FlowInstanceListResponse,
  FlowInstanceNotFoundError,
  FlowStepActionError,
  FlowStepInstanceDto,
  FlowStepNotFoundError,
} from '../../application/FlowAuditService'
import { FlowInstanceStatus } from '@prisma/client'

@Route('ops/flows/instances')
@Security('OpsApiKeyAuth')
export class FlowInstanceController extends Controller {
  constructor(
    @inject(FlowAuditService) private readonly auditService: FlowAuditService,
  ) {
    super()
  }

  @Get()
  @SuccessResponse('200', 'Flow instances retrieved')
  public async list(
    @Query() status?: FlowInstanceStatus,
    @Query() transactionId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() stuckMinutes?: number,
  ): Promise<FlowInstanceListResponse> {
    return this.auditService.list({
      page,
      pageSize,
      status,
      stuckMinutes,
      transactionId,
    })
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

  @Post('{flowInstanceId}/steps/{stepInstanceId}/retry')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async retryStep(
    @Path() flowInstanceId: string,
    @Path() stepInstanceId: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.auditService.resetStep(flowInstanceId, stepInstanceId, 'retry')
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
}
