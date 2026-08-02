import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowInstanceStatus,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import {
  FlowAuditService,
  FlowBulkRetryResult,
  FlowFailureFilter,
  FlowInstanceDetailDto,
  FlowInstanceListResponse,
  FlowInstanceNotFoundError,
  FlowQueryValidationError,
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
export class FlowInstanceController extends Controller {
  constructor(
    @inject(FlowAuditService) private readonly auditService: FlowAuditService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  /**
   * Resume many stalled flow instances at once, returning a per-instance outcome.
   */
  @Post('bulk-retry')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['flows:recover'])
  public async bulkRetry(
    @Body() body: FlowBulkRetryRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<FlowBulkRetryResponse> {
    const flowInstanceIds = body?.flowInstanceIds ?? []
    if (flowInstanceIds.length === 0) {
      return badRequest(400, { reason: 'flowInstanceIds must not be empty' })
    }
    if (flowInstanceIds.length > BULK_RETRY_MAX) {
      return badRequest(400, { reason: `Cannot bulk-retry more than ${BULK_RETRY_MAX} instances at once` })
    }

    const results = await this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'flow.bulk_retry',
      { type: 'flow_instance_collection' },
      readOpsMutationEnvelope(request),
      () => this.auditService.bulkRetry(flowInstanceIds),
      result => ({
        metadata: {
          attemptedCount: result.length,
          failedCount: result.filter(item => !item.ok).length,
        },
      }),
    )
    return {
      failed: results.filter(result => !result.ok).length,
      results,
      succeeded: results.filter(result => result.ok).length,
    }
  }

  @Get('{flowInstanceId}')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['flows:read'])
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
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['flows:read'])
  @SuccessResponse('200', 'Flow instances retrieved')
  public async list(
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Query() status?: FlowInstanceStatus,
    @Query() transactionId?: string,
    @Query() onChainId?: string,
    @Query() partnerId?: string,
    @Query() createdFrom?: string,
    @Query() createdTo?: string,
    @Query() payoutProvider?: PaymentMethod,
    @Query() cryptoCurrency?: CryptoCurrency,
    @Query() blockchain?: BlockchainNetwork,
    @Query() targetCurrency?: TargetCurrency,
    @Query() failure?: FlowFailureFilter,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() stuckMinutes?: number,
  ): Promise<FlowInstanceListResponse> {
    try {
      return await this.auditService.list({
        blockchain,
        createdFrom,
        createdTo,
        cryptoCurrency,
        failure,
        onChainId,
        page,
        pageSize,
        partnerId,
        payoutProvider,
        status,
        stuckMinutes,
        targetCurrency,
        transactionId,
      })
    }
    catch (error) {
      if (error instanceof FlowQueryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Post('{flowInstanceId}/steps/{stepInstanceId}/requeue')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['flows:recover'])
  public async requeueStep(
    @Path() flowInstanceId: string,
    @Path() stepInstanceId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'flow.step.requeue',
        { id: stepInstanceId, type: 'flow_step' },
        readOpsMutationEnvelope(request),
        () => this.auditService.resetStep(flowInstanceId, stepInstanceId, 'requeue'),
      )
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
  @Security('OpsAuth', ['flows:recover'])
  public async resume(
    @Path() flowInstanceId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'flow.resume',
        { id: flowInstanceId, type: 'flow_instance' },
        readOpsMutationEnvelope(request),
        () => this.auditService.resumeInstance(flowInstanceId),
      )
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
  @Security('OpsAuth', ['flows:recover'])
  public async retryStep(
    @Path() flowInstanceId: string,
    @Path() stepInstanceId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
    @Query() force?: boolean,
  ): Promise<FlowStepInstanceDto> {
    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        force === true ? 'flow.step.force_retry' : 'flow.step.retry',
        { id: stepInstanceId, type: 'flow_step' },
        readOpsMutationEnvelope(request),
        () => this.auditService.resetStep(
          flowInstanceId,
          stepInstanceId,
          'retry',
          { force: force === true },
        ),
      )
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
