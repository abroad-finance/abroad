import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Delete,
  Get,
  OperationId,
  Patch,
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
import { OpsAuditService } from '../../../operations/application/OpsAuditService'
import { OpsMutationAction, OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import { OpsPartnerNotFoundError, OpsPartnerService, OpsPartnerValidationError } from '../../application/OpsPartnerService'
import {
  OpsCreatePartnerRequest,
  opsCreatePartnerRequestSchema,
  OpsCreatePartnerResponse,
  OpsPartnerCredentialHistoryResponse,
  OpsPartnerListResponse,
  OpsRotatePartnerApiKeyResponse,
  OpsUpdatePartnerClientDomainRequest,
  opsUpdatePartnerClientDomainRequestSchema,
  OpsUpdatePartnerClientDomainResponse,
  OpsUpdatePartnerKybRequest,
  opsUpdatePartnerKybRequestSchema,
  OpsUpdatePartnerKybResponse,
  OpsUpdatePartnerKycRequest,
  opsUpdatePartnerKycRequestSchema,
  OpsUpdatePartnerKycResponse,
  OpsUpdatePartnerProfileRequest,
  opsUpdatePartnerProfileRequestSchema,
  OpsUpdatePartnerProfileResponse,
  OpsUpdatePartnerStatusRequest,
  opsUpdatePartnerStatusRequestSchema,
  OpsUpdatePartnerStatusResponse,
  OpsUpdatePartnerWebhookRequest,
  opsUpdatePartnerWebhookRequestSchema,
  OpsUpdatePartnerWebhookResponse,
  parsePartnerId,
  parsePartnerPagination,
} from './opsContracts'

@Route('ops/partners')
export class OpsPartnerController extends Controller {
  constructor(
    @inject(OpsPartnerService) private readonly opsPartnerService: OpsPartnerService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
    @inject(OpsAuditService) private readonly auditService: OpsAuditService,
  ) {
    super()
  }

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('201', 'Partner created')
  public async createPartner(
    @Body() body: OpsCreatePartnerRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() created: TsoaResponse<201, OpsCreatePartnerResponse>,
  ): Promise<OpsCreatePartnerResponse> {
    const parsedBody = opsCreatePartnerRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }

    try {
      const result = await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'partner.create',
        { type: 'partner' },
        readOpsMutationEnvelope(request),
        () => this.opsPartnerService.createPartner(parsedBody.data),
        value => ({ resourceId: value.partner.id }),
      )
      return created(201, result)
    }
    catch (error) {
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Get('{partnerId}/credential-history')
  @OperationId('GetPartnerCredentialHistory')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['credentials:manage'])
  @SuccessResponse('200', 'Partner credential history retrieved')
  public async getCredentialHistory(
    @Path() partnerId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsPartnerCredentialHistoryResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    try {
      const result = await this.opsPartnerService.getCredentialHistory(parsedPartnerId.data)
      await this.auditService.record(requireOpsPrincipal(request.user), {
        action: 'credentials.history.viewed',
        resourceId: parsedPartnerId.data,
        resourceType: 'partner',
      })
      return result
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      throw error
    }
  }

  @Get()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['credentials:manage'])
  @SuccessResponse('200', 'Partners retrieved')
  public async listPartners(
    @Query() page: number = 1,
    @Query() pageSize: number = 20,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<OpsPartnerListResponse> {
    const parsed = parsePartnerPagination({ page, pageSize })
    if ('error' in parsed) {
      return badRequest(400, { reason: parsed.error })
    }

    return this.opsPartnerService.listPartners(parsed.data)
  }

  @Delete('{partnerId}/api-key')
  @OperationId('RevokePartnerApiKey')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['credentials:manage'])
  @SuccessResponse('204', 'Partner API key revoked')
  public async revokeApiKey(
    @Path() partnerId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<void> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      badRequest(400, { reason: parsedPartnerId.error })
      return
    }

    try {
      await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'credentials.api_key.revoke',
        { id: parsedPartnerId.data, type: 'partner' },
        readOpsMutationEnvelope(request),
        () => this.opsPartnerService.revokeApiKey(parsedPartnerId.data),
      )
      this.setStatus(204)
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        notFound(404, { reason: error.message })
        return
      }
      throw error
    }
  }

  @OperationId('RotatePartnerApiKey')
  @Post('{partnerId}/api-key')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['credentials:manage'])
  @SuccessResponse('200', 'Partner API key rotated')
  public async rotateApiKey(
    @Path() partnerId: string,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsRotatePartnerApiKeyResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'credentials.api_key.rotate',
        { id: parsedPartnerId.data, type: 'partner' },
        readOpsMutationEnvelope(request),
        () => this.opsPartnerService.rotateApiKey(parsedPartnerId.data),
      )
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('UpdatePartnerClientDomain')
  @Patch('{partnerId}/client-domain')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['credentials:manage'])
  @SuccessResponse('200', 'Partner client domain updated')
  public async updateClientDomain(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerClientDomainRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerClientDomainResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    const parsedBody = opsUpdatePartnerClientDomainRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }

    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'credentials.client_domain.update',
        { id: parsedPartnerId.data, type: 'partner' },
        readOpsMutationEnvelope(request),
        () => this.opsPartnerService.updateClientDomain(parsedPartnerId.data, parsedBody.data),
      )
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('UpdatePartnerKybApproval')
  @Patch('{partnerId}/kyb')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('200', 'Partner KYB approval updated')
  public async updateKybApproval(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerKybRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerKybResponse> {
    return this.runPartnerMutation({
      badRequest,
      body,
      execute: (id, input) => this.opsPartnerService.updateKybApproval(id, input),
      mutationAction: 'partner.kyb_approval.update',
      notFound,
      partnerId,
      request,
      schema: opsUpdatePartnerKybRequestSchema,
    })
  }

  @OperationId('UpdatePartnerKycRequirement')
  @Patch('{partnerId}/kyc')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('200', 'Partner KYC requirement updated')
  public async updateKycRequirement(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerKycRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerKycResponse> {
    const parsedPartnerId = parsePartnerId(partnerId)
    if ('error' in parsedPartnerId) {
      return badRequest(400, { reason: parsedPartnerId.error })
    }

    const parsedBody = opsUpdatePartnerKycRequestSchema.safeParse(body)
    if (!parsedBody.success) {
      return badRequest(400, { reason: parsedBody.error.message })
    }

    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(request.user),
        'partner.kyc_requirement.update',
        { id: parsedPartnerId.data, type: 'partner' },
        readOpsMutationEnvelope(request),
        () => this.opsPartnerService.updateKycRequirement(parsedPartnerId.data, parsedBody.data),
      )
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return notFound(404, { reason: error.message })
      }
      if (error instanceof OpsPartnerValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @OperationId('UpdatePartnerProfile')
  @Patch('{partnerId}/profile')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('200', 'Partner profile updated')
  public async updateProfile(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerProfileRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerProfileResponse> {
    return this.runPartnerMutation({
      badRequest,
      body,
      execute: (id, input) => this.opsPartnerService.updateProfile(id, input),
      mutationAction: 'partner.profile.update',
      notFound,
      partnerId,
      request,
      schema: opsUpdatePartnerProfileRequestSchema,
    })
  }

  @OperationId('UpdatePartnerStatus')
  @Patch('{partnerId}/status')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('200', 'Partner status updated')
  public async updateStatus(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerStatusRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerStatusResponse> {
    const principal = requireOpsPrincipal(request.user)
    return this.runPartnerMutation({
      badRequest,
      body,
      execute: (id, input) => this.opsPartnerService.updateStatus(id, input, principal.email),
      mutationAction: 'partner.status.update',
      notFound,
      partnerId,
      request,
      schema: opsUpdatePartnerStatusRequestSchema,
    })
  }

  @OperationId('UpdatePartnerWebhook')
  @Patch('{partnerId}/webhook')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['partners:manage'])
  @SuccessResponse('200', 'Partner webhook updated')
  public async updateWebhook(
    @Path() partnerId: string,
    @Body() body: OpsUpdatePartnerWebhookRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
    @Res() notFound: TsoaResponse<404, { reason: string }>,
  ): Promise<OpsUpdatePartnerWebhookResponse> {
    return this.runPartnerMutation({
      badRequest,
      body,
      execute: (id, input) => this.opsPartnerService.updateWebhookUrl(id, input),
      mutationAction: 'partner.webhook.update',
      notFound,
      partnerId,
      request,
      schema: opsUpdatePartnerWebhookRequestSchema,
    })
  }

  /**
   * Shared shape for the single-field partner PATCHes: validate the id, parse
   * the body, then run the change through OpsMutationService so each one keeps
   * step-up approval and the audit trail.
   */
  private async runPartnerMutation<TBody, TResult>(params: {
    badRequest: TsoaResponse<400, { reason: string }>
    body: unknown
    execute: (partnerId: string, input: TBody) => Promise<TResult>
    mutationAction: OpsMutationAction
    notFound: TsoaResponse<404, { reason: string }>
    partnerId: string
    request: RequestExpress
    schema: { safeParse: (value: unknown) => { data: TBody, success: true } | { error: { message: string }, success: false } }
  }): Promise<TResult> {
    const parsedPartnerId = parsePartnerId(params.partnerId)
    if ('error' in parsedPartnerId) {
      return params.badRequest(400, { reason: parsedPartnerId.error })
    }

    const parsedBody = params.schema.safeParse(params.body)
    if (!parsedBody.success) {
      return params.badRequest(400, { reason: parsedBody.error.message })
    }

    try {
      return await this.mutationService.execute(
        requireOpsPrincipal(params.request.user),
        params.mutationAction,
        { id: parsedPartnerId.data, type: 'partner' },
        readOpsMutationEnvelope(params.request),
        () => params.execute(parsedPartnerId.data, parsedBody.data),
      )
    }
    catch (error) {
      if (error instanceof OpsPartnerNotFoundError) {
        return params.notFound(404, { reason: error.message })
      }
      if (error instanceof OpsPartnerValidationError) {
        return params.badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
