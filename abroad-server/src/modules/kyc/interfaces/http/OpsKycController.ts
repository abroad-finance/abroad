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

import { InfrastructureError, ValidationError } from '../../../../core/errors'
import { OpsKycService } from '../../application/OpsKycService'
import {
  OpsKycDisableUserRequest,
  opsKycDisableUserSchema,
  opsKycIdSchema,
  opsKycListQuerySchema,
  OpsKycListResponse,
  OpsKycRejectResponse,
  OpsKycUserStateResponse,
} from './opsKycContracts'

@Route('ops/kyc')
@Security('OpsApiKeyAuth')
export class OpsKycController extends Controller {
  constructor(
    @inject(OpsKycService) private readonly opsKycService: OpsKycService,
  ) {
    super()
  }

  @Post('users/{partnerUserId}/disable')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'User disabled')
  public async disableUser(
    @Path() partnerUserId: string,
    @Body() body: OpsKycDisableUserRequest,
  ): Promise<OpsKycUserStateResponse> {
    const parsedId = opsKycIdSchema.safeParse(partnerUserId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid user id')
    }
    const parsedBody = opsKycDisableUserSchema.safeParse(body ?? {})
    if (!parsedBody.success) {
      throw new ValidationError(parsedBody.error.issues[0]?.message ?? 'Invalid request')
    }
    return this.opsKycService.disableUser({
      disabledBy: parsedBody.data.disabledBy,
      partnerUserId: parsedId.data,
      reason: parsedBody.data.reason,
    })
  }

  @Post('users/{partnerUserId}/enable')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'User enabled')
  public async enableUser(
    @Path() partnerUserId: string,
  ): Promise<OpsKycUserStateResponse> {
    const parsedId = opsKycIdSchema.safeParse(partnerUserId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid user id')
    }
    return this.opsKycService.enableUser(parsedId.data)
  }

  /**
   * Streams the stored identity-document image. The bucket stays private; bytes
   * are only ever served through this ops-authenticated endpoint.
   */
  @Get('{kycId}/document')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  public async getDocument(
    @Path() kycId: string,
    @Request() request: RequestExpress,
  ): Promise<void> {
    const parsedId = opsKycIdSchema.safeParse(kycId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid id')
    }
    const { buffer, contentType } = await this.opsKycService.getDocument(parsedId.data)

    const response = request.res
    if (!response) {
      throw new InfrastructureError('Response stream unavailable')
    }
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Content-Length', String(buffer.length))
    response.setHeader('Content-Type', contentType)
    response.status(200).end(buffer)
  }

  @Get()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'KYC submissions retrieved')
  public async listSubmissions(
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() status?: string,
  ): Promise<OpsKycListResponse> {
    const parsed = opsKycListQuerySchema.safeParse({ page, pageSize, status })
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid query')
    }
    return this.opsKycService.listSubmissions(parsed.data)
  }

  @Post('{kycId}/reject')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'KYC submission rejected')
  public async rejectKyc(
    @Path() kycId: string,
  ): Promise<OpsKycRejectResponse> {
    const parsedId = opsKycIdSchema.safeParse(kycId)
    if (!parsedId.success) {
      throw new ValidationError('Invalid id')
    }
    return this.opsKycService.rejectKyc(parsedId.data)
  }
}
