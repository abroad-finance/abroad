import type { Request as ExpressRequest } from 'express'

import { PartnerPortalRole } from '@prisma/client'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
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
import { z } from 'zod'

import { requirePartnerPortalMfaAdministrator } from '../../../../app/http/authenticationContext'
import {
  PartnerPortalAuditEventDto,
  PartnerPortalResetTokenResult,
  PartnerPortalTeamNotFoundError,
  PartnerPortalTeamService,
  PartnerPortalTeamValidationError,
  PartnerPortalUserSummary,
} from '../../application/PartnerPortalTeamService'

type PartnerPortalTeamErrorResponse = { reason: string }

const createUserSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.nativeEnum(PartnerPortalRole),
}).strict()

const updateUserSchema = z.object({
  disabled: z.boolean().optional(),
  role: z.nativeEnum(PartnerPortalRole).optional(),
}).strict().refine(
  value => value.disabled !== undefined || value.role !== undefined,
  'No account change was requested',
)

@Route('partner-portal/team')
@Security('PartnerPortalAuth', ['admin', 'mfa'])
export class PartnerPortalTeamController extends Controller {
  public constructor(
    @inject(PartnerPortalTeamService)
    private readonly teamService: PartnerPortalTeamService,
  ) {
    super()
  }

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('201', 'Portal user created')
  public async createUser(
    @Request() request: ExpressRequest,
    @Body() body: { email: string, role: PartnerPortalRole },
    @Res() badRequest: TsoaResponse<400, PartnerPortalTeamErrorResponse>,
    @Res() created: TsoaResponse<201, PartnerPortalResetTokenResult>,
  ): Promise<PartnerPortalResetTokenResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Enter a valid email and role' })
    }
    try {
      const result = await this.teamService.createUser(
        requirePartnerPortalMfaAdministrator(request.user),
        parsed.data,
      )
      return created(201, result)
    }
    catch (error) {
      if (error instanceof PartnerPortalTeamValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Post('{userId}/password-reset')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'Password reset issued')
  public async issuePasswordReset(
    @Path() userId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalTeamErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerPortalTeamErrorResponse>,
  ): Promise<PartnerPortalResetTokenResult> {
    this.setHeader('Cache-Control', 'private, no-store')
    try {
      return await this.teamService.issuePasswordReset(
        requirePartnerPortalMfaAdministrator(request.user),
        userId,
      )
    }
    catch (error) {
      return this.handleTeamError(error, badRequest, notFound)
    }
  }

  @Get('audit-events')
  @SuccessResponse('200', 'Audit events retrieved')
  public async listAuditEvents(
    @Request() request: ExpressRequest,
    @Query() limit?: number,
  ): Promise<PartnerPortalAuditEventDto[]> {
    const principal = requirePartnerPortalMfaAdministrator(request.user)
    return this.teamService.listAuditEvents(principal.partner.id, limit)
  }

  @Get()
  @SuccessResponse('200', 'Portal users retrieved')
  public async listUsers(
    @Request() request: ExpressRequest,
  ): Promise<PartnerPortalUserSummary[]> {
    return this.teamService.listUsers(
      requirePartnerPortalMfaAdministrator(request.user).partner.id,
    )
  }

  @Post('{userId}/mfa-reset')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'MFA factor reset')
  public async resetMfa(
    @Path() userId: string,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, PartnerPortalTeamErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerPortalTeamErrorResponse>,
  ): Promise<PartnerPortalUserSummary> {
    try {
      return await this.teamService.resetMfa(
        requirePartnerPortalMfaAdministrator(request.user),
        userId,
      )
    }
    catch (error) {
      return this.handleTeamError(error, badRequest, notFound)
    }
  }

  @Patch('{userId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'Portal user updated')
  public async updateUser(
    @Path() userId: string,
    @Request() request: ExpressRequest,
    @Body() body: { disabled?: boolean, role?: PartnerPortalRole },
    @Res() badRequest: TsoaResponse<400, PartnerPortalTeamErrorResponse>,
    @Res() notFound: TsoaResponse<404, PartnerPortalTeamErrorResponse>,
  ): Promise<PartnerPortalUserSummary> {
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.issues[0]?.message ?? 'Invalid account change' })
    }
    try {
      return await this.teamService.updateUser(
        requirePartnerPortalMfaAdministrator(request.user),
        userId,
        parsed.data,
      )
    }
    catch (error) {
      return this.handleTeamError(error, badRequest, notFound)
    }
  }

  private handleTeamError<T>(
    error: unknown,
    badRequest: TsoaResponse<400, PartnerPortalTeamErrorResponse>,
    notFound: TsoaResponse<404, PartnerPortalTeamErrorResponse>,
  ): T {
    if (error instanceof PartnerPortalTeamValidationError) {
      return badRequest(400, { reason: error.message }) as T
    }
    if (error instanceof PartnerPortalTeamNotFoundError) {
      return notFound(404, { reason: error.message }) as T
    }
    throw error
  }
}
