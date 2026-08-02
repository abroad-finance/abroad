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
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { requireNamedOpsPrincipal, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { InfrastructureError, ValidationError } from '../../../../core/errors'
import { OpsAuditService } from '../../../operations/application/OpsAuditService'
import { OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import { OpsKycService } from '../../application/OpsKycService'
import {
  OpsKycAssignmentResponse,
  OpsKycAssignRequest,
  opsKycAssignSchema,
  OpsKycDetailResponse,
  OpsKycDisableUserRequest,
  opsKycDisableUserSchema,
  opsKycIdSchema,
  opsKycListQuerySchema,
  OpsKycListResponse,
  OpsKycRejectResponse,
  OpsKycReviewerListResponse,
  OpsKycUserStateResponse,
} from './opsKycContracts'

@Route('ops/kyc')
export class OpsKycController extends Controller {
  constructor(
    @inject(OpsKycService) private readonly opsKycService: OpsKycService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
    @inject(OpsAuditService) private readonly auditService: OpsAuditService,
  ) {
    super()
  }

  @Post('{kycId}/assign')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['kyc:decide'])
  @SuccessResponse('200', 'KYC review assigned')
  public async assignReviewer(
    @Path() kycId: string,
    @Body() body: OpsKycAssignRequest,
    @Request() request: RequestExpress,
  ): Promise<OpsKycAssignmentResponse> {
    const parsedId = opsKycIdSchema.safeParse(kycId)
    const parsedBody = opsKycAssignSchema.safeParse(body)
    if (!parsedId.success) throw new ValidationError('Invalid id')
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid reviewer')
    }
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'kyc.submission.assign',
      { id: parsedId.data, type: 'kyc_submission' },
      envelope,
      () => this.opsKycService.assignReviewer(
        parsedId.data,
        parsedBody.data.reviewerUserId,
        envelope.expectedVersion ?? 0,
      ),
    )
  }

  @Post('users/{partnerUserId}/disable')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['kyc:decide'])
  @SuccessResponse('200', 'User disabled')
  public async disableUser(
    @Path() partnerUserId: string,
    @Body() body: OpsKycDisableUserRequest,
    @Request() request: RequestExpress,
  ): Promise<OpsKycUserStateResponse> {
    const parsedId = opsKycIdSchema.safeParse(partnerUserId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid user id')
    }
    const parsedBody = opsKycDisableUserSchema.safeParse(body ?? {})
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid request')
    }
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'kyc.user.disable',
      { id: parsedId.data, type: 'partner_user' },
      readOpsMutationEnvelope(request),
      () => this.opsKycService.disableUser({
        disabledBy: parsedBody.data.disabledBy,
        partnerUserId: parsedId.data,
        reason: parsedBody.data.reason,
      }),
    )
  }

  @Post('users/{partnerUserId}/enable')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['kyc:decide'])
  @SuccessResponse('200', 'User enabled')
  public async enableUser(
    @Path() partnerUserId: string,
    @Request() request: RequestExpress,
  ): Promise<OpsKycUserStateResponse> {
    const parsedId = opsKycIdSchema.safeParse(partnerUserId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid user id')
    }
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'kyc.user.enable',
      { id: parsedId.data, type: 'partner_user' },
      readOpsMutationEnvelope(request),
      () => this.opsKycService.enableUser(parsedId.data),
    )
  }

  /**
   * Streams the stored identity-document image. The bucket stays private; bytes
   * are only ever served through this ops-authenticated endpoint.
   */
  @Get('{kycId}/document')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['kyc:reveal'])
  public async getDocument(
    @Path() kycId: string,
    @Request() request: RequestExpress,
  ): Promise<void> {
    const parsedId = opsKycIdSchema.safeParse(kycId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid id')
    }
    const { buffer, contentType } = await this.opsKycService.getDocument(parsedId.data)

    await this.auditService.record(requireNamedOpsPrincipal(request.user), {
      action: 'kyc.document.revealed',
      resourceId: parsedId.data,
      resourceType: 'kyc_submission',
    })

    const response = request.res
    if (!response) {
      throw new InfrastructureError('Response stream unavailable')
    }
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Content-Length', String(buffer.length))
    response.setHeader('Content-Type', contentType)
    response.status(200).end(buffer)
  }

  @Get('reviewer-options')
  @Security('OpsAuth', ['kyc:read'])
  @SuccessResponse('200', 'KYC reviewers retrieved')
  public async getReviewerOptions(): Promise<OpsKycReviewerListResponse> {
    return { items: await this.opsKycService.listReviewers() }
  }

  @Get('{kycId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['kyc:reveal'])
  @SuccessResponse('200', 'KYC submission details retrieved')
  public async getSubmission(
    @Path() kycId: string,
    @Request() request: RequestExpress,
  ): Promise<OpsKycDetailResponse> {
    const parsedId = opsKycIdSchema.safeParse(kycId)
    if (!parsedId.success) throw new ValidationError('Invalid id')
    const detail = await this.opsKycService.getSubmission(parsedId.data)
    await this.auditService.record(requireNamedOpsPrincipal(request.user), {
      action: 'kyc.submission.revealed',
      resourceId: parsedId.data,
      resourceType: 'kyc_submission',
    })
    return detail
  }

  @Get()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['kyc:read'])
  @SuccessResponse('200', 'KYC submissions retrieved')
  public async listSubmissions(
    @Request() request: RequestExpress,
    @Query() ageHoursGte?: number,
    @Query() createdFrom?: Date,
    @Query() createdTo?: Date,
    @Query() documentType?: string,
    @Query() nationality?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() partnerId?: string,
    @Query() query?: string,
    @Query() reviewer?: string,
    @Query() status?: string,
  ): Promise<OpsKycListResponse> {
    const parsed = opsKycListQuerySchema.safeParse({
      ageHoursGte,
      createdFrom,
      createdTo,
      documentType,
      nationality,
      page,
      pageSize,
      partnerId,
      query,
      reviewer,
      status,
    })
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid query')
    }
    const result = await this.opsKycService.listSubmissions(parsed.data)
    await this.auditService.record(requireNamedOpsPrincipal(request.user), {
      action: 'kyc.queue.viewed',
      metadata: { page: parsed.data.page, pageSize: parsed.data.pageSize },
      resourceType: 'kyc_queue',
    })
    return result
  }

  @Post('{kycId}/reject')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['kyc:decide'])
  @SuccessResponse('200', 'KYC submission rejected')
  public async rejectKyc(
    @Path() kycId: string,
    @Request() request: RequestExpress,
  ): Promise<OpsKycRejectResponse> {
    const parsedId = opsKycIdSchema.safeParse(kycId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid id')
    }
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'kyc.submission.reject',
      { id: parsedId.data, type: 'kyc_submission' },
      readOpsMutationEnvelope(request),
      () => this.opsKycService.rejectKyc(parsedId.data),
    )
  }
}
