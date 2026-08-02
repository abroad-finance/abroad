import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { requirePartnerPortalAdministrator, requirePartnerPortalMfaAdministrator, requirePartnerPortalPrincipal } from '../../../../app/http/authenticationContext'
import { PartnerAiAuthorizationRequestDto, PartnerAiAuthorizationResolution, PartnerAiAuthorizationService } from '../../application/PartnerAiAuthorizationService'
import { PartnerAiAccountMetadata, PartnerAiConnectionDto, PartnerAiConnectionService } from '../../application/PartnerAiConnectionService'
import { PartnerAiPortalError } from '../../application/PartnerAiErrors'
import {
  partnerAiProductClientCategories,
  partnerAiProductEntryPoints,
  PartnerAiProductEventInput,
  partnerAiProductEventNames,
  PartnerAiProductEventService,
  partnerAiProductOutcomes,
} from '../../application/PartnerAiProductEventService'

type PartnerAiErrorResponse = {
  code: string
  reason: string
}

const productEventSchema = z.object({
  clientCategory: z.enum(partnerAiProductClientCategories),
  entryPoint: z.enum(partnerAiProductEntryPoints),
  event: z.enum(partnerAiProductEventNames),
  outcome: z.enum(partnerAiProductOutcomes),
}).strict()

@Route('partner-portal/ai')
export class PartnerAiController extends Controller {
  public constructor(
    @inject(PartnerAiAuthorizationService)
    private readonly authorizationService: PartnerAiAuthorizationService,
    @inject(PartnerAiConnectionService)
    private readonly connectionService: PartnerAiConnectionService,
    @inject(PartnerAiProductEventService)
    private readonly productEventService: PartnerAiProductEventService,
  ) {
    super()
  }

  @Post('authorization-requests/{requestId}/approval')
  @Response<PartnerAiErrorResponse>(400, 'Invalid authorization request')
  @Response<PartnerAiErrorResponse>(403, 'Administrator or MFA required')
  @Response<PartnerAiErrorResponse>(404, 'Authorization request not found')
  @Response<PartnerAiErrorResponse>(409, 'Authorization request resolved or expired')
  @Security('PartnerPortalAuth', ['admin'])
  @SuccessResponse('200', 'AI client authorized')
  public async approve(
    @Path() requestId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerAiErrorResponse>,
    @Res() forbidden: TsoaResponse<403, PartnerAiErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerAiErrorResponse>,
    @Res() conflict: TsoaResponse<409, PartnerAiErrorResponse>,
  ): Promise<PartnerAiAuthorizationResolution> {
    this.setHeader('Cache-Control', 'private, no-store')
    try {
      return await this.authorizationService.approve(
        requirePartnerPortalAdministrator(request.user),
        requestId,
      )
    }
    catch (error) {
      return this.handlePortalError(error, { badRequest, conflict, forbidden, notFound })
    }
  }

  @Post('authorization-requests/{requestId}/denial')
  @Response<PartnerAiErrorResponse>(400, 'Invalid authorization request')
  @Response<PartnerAiErrorResponse>(403, 'Administrator required')
  @Response<PartnerAiErrorResponse>(404, 'Authorization request not found')
  @Response<PartnerAiErrorResponse>(409, 'Authorization request resolved or expired')
  @Security('PartnerPortalAuth', ['admin'])
  @SuccessResponse('200', 'AI client authorization denied')
  public async deny(
    @Path() requestId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerAiErrorResponse>,
    @Res() forbidden: TsoaResponse<403, PartnerAiErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerAiErrorResponse>,
    @Res() conflict: TsoaResponse<409, PartnerAiErrorResponse>,
  ): Promise<PartnerAiAuthorizationResolution> {
    this.setHeader('Cache-Control', 'private, no-store')
    try {
      return await this.authorizationService.deny(
        requirePartnerPortalAdministrator(request.user),
        requestId,
      )
    }
    catch (error) {
      return this.handlePortalError(error, { badRequest, conflict, forbidden, notFound })
    }
  }

  @Get('authorization-requests/{requestId}')
  @Response<PartnerAiErrorResponse>(404, 'Authorization request not found')
  @Security('PartnerPortalAuth')
  @SuccessResponse('200', 'Authorization request retrieved')
  public async getAuthorizationRequest(
    @Path() requestId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerAiErrorResponse>,
    @Res() forbidden: TsoaResponse<403, PartnerAiErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerAiErrorResponse>,
    @Res() conflict: TsoaResponse<409, PartnerAiErrorResponse>,
  ): Promise<PartnerAiAuthorizationRequestDto> {
    this.setHeader('Cache-Control', 'private, no-store')
    try {
      return await this.authorizationService.getAuthorizationRequest(
        requirePartnerPortalPrincipal(request.user),
        requestId,
      )
    }
    catch (error) {
      return this.handlePortalError(error, { badRequest, conflict, forbidden, notFound })
    }
  }

  @Get('connections')
  @Security('PartnerPortalAuth')
  @SuccessResponse('200', 'Connected AI clients retrieved')
  public async listConnections(
    @Request() request: ExpressRequest,
  ): Promise<{ items: PartnerAiConnectionDto[] }> {
    this.setHeader('Cache-Control', 'private, no-store')
    return {
      items: await this.connectionService.list(requirePartnerPortalPrincipal(request.user)),
    }
  }

  @Post('product-events')
  @Response<PartnerAiErrorResponse>(400, 'Invalid product event')
  @Security('PartnerPortalAuth')
  @SuccessResponse('204', 'Product event recorded')
  public recordProductEvent(
    @Request() request: ExpressRequest,
    @Body() body: PartnerAiProductEventInput,
    @Res() badRequest: TsoaResponse<400, PartnerAiErrorResponse>,
  ): void {
    const parsed = productEventSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { code: 'INVALID_EVENT', reason: 'Product event is invalid' })
    }
    this.productEventService.record(requirePartnerPortalPrincipal(request.user), parsed.data)
    this.setStatus(204)
  }

  @Delete('connections/{connectionId}')
  @Response<PartnerAiErrorResponse>(403, 'Administrator with MFA required')
  @Response<PartnerAiErrorResponse>(404, 'Connected AI client not found')
  @Security('PartnerPortalAuth', ['admin', 'mfa'])
  @SuccessResponse('200', 'Connected AI client revoked')
  public async revokeConnection(
    @Path() connectionId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerAiErrorResponse>,
    @Res() forbidden: TsoaResponse<403, PartnerAiErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerAiErrorResponse>,
    @Res() conflict: TsoaResponse<409, PartnerAiErrorResponse>,
  ): Promise<PartnerAiConnectionDto> {
    try {
      return await this.connectionService.revoke(
        requirePartnerPortalMfaAdministrator(request.user),
        connectionId,
      )
    }
    catch (error) {
      return this.handlePortalError(error, { badRequest, conflict, forbidden, notFound })
    }
  }

  @Post('connections/{connectionId}/test')
  @Response<PartnerAiErrorResponse>(404, 'Connected AI client not found')
  @Response<PartnerAiErrorResponse>(409, 'Connected AI client inactive')
  @Security('PartnerPortalAuth')
  @SuccessResponse('200', 'Connected AI client verified')
  public async testConnection(
    @Path() connectionId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerAiErrorResponse>,
    @Res() forbidden: TsoaResponse<403, PartnerAiErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerAiErrorResponse>,
    @Res() conflict: TsoaResponse<409, PartnerAiErrorResponse>,
  ): Promise<PartnerAiAccountMetadata> {
    try {
      return await this.connectionService.test(
        requirePartnerPortalPrincipal(request.user),
        connectionId,
      )
    }
    catch (error) {
      return this.handlePortalError(error, { badRequest, conflict, forbidden, notFound })
    }
  }

  private handlePortalError<T>(
    error: unknown,
    responses: {
      badRequest: TsoaResponse<400, PartnerAiErrorResponse>
      conflict: TsoaResponse<409, PartnerAiErrorResponse>
      forbidden: TsoaResponse<403, PartnerAiErrorResponse>
      notFound: TsoaResponse<404, PartnerAiErrorResponse>
    },
  ): T {
    if (!(error instanceof PartnerAiPortalError)) throw error
    const body = { code: error.code, reason: error.message }
    if (error.code === 'NOT_FOUND') return responses.notFound(404, body) as T
    if (error.code === 'ADMIN_REQUIRED' || error.code === 'MFA_REQUIRED') {
      return responses.forbidden(403, body) as T
    }
    if (
      error.code === 'ALREADY_RESOLVED'
      || error.code === 'CONNECTION_INACTIVE'
      || error.code === 'REQUEST_EXPIRED'
    ) {
      return responses.conflict(409, body) as T
    }
    return responses.badRequest(400, body) as T
  }
}
