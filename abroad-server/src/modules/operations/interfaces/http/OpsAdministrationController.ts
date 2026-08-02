import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Patch,
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
import {
  OpsAdministrationService,
  OpsAdministrationValidationError,
  OpsAuditListDto,
  OpsUserDto,
  OpsUserInviteInput,
  opsUserInviteSchema,
  OpsUserListDto,
  OpsUserRoleUpdateInput,
  opsUserRoleUpdateSchema,
} from '../../application/OpsAdministrationService'
import { OpsMutationService } from '../../application/opsMutation'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

@Route('ops/administration')
export class OpsAdministrationController extends Controller {
  public constructor(
    @inject(OpsAdministrationService)
    private readonly administrationService: OpsAdministrationService,
    @inject(OpsMutationService)
    private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @OperationId('DisableOpsUser')
  @Post('users/{userId}/disable')
  @Response<400, { reason: string }>(400, 'Bad request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:users'])
  @SuccessResponse('200', 'Ops user disabled')
  public async disableUser(
    @Path() userId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsUserDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      principal,
      'administration.user.disable',
      { id: userId, type: 'ops_user' },
      envelope,
      () => this.administrationService.disableUser(
        userId,
        envelope.expectedVersion ?? 0,
        principal.userId,
      ),
    )
  }

  @OperationId('EnableOpsUser')
  @Post('users/{userId}/enable')
  @Response<400, { reason: string }>(400, 'Bad request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:users'])
  @SuccessResponse('200', 'Ops user enabled')
  public async enableUser(
    @Path() userId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsUserDto> {
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'administration.user.enable',
      { id: userId, type: 'ops_user' },
      envelope,
      () => this.administrationService.enableUser(
        userId,
        envelope.expectedVersion ?? 0,
      ),
    )
  }

  @OperationId('InviteOpsUser')
  @Post('users')
  @Response<400, { reason: string }>(400, 'Bad request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:users'])
  @SuccessResponse('201', 'Ops user invited')
  public async inviteUser(
    @Body() body: OpsUserInviteInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsUserDto> {
    const result = opsUserInviteSchema.safeParse(body)
    if (!result.success) {
      throw new OpsAdministrationValidationError(
        result.error.issues[0]?.message ?? 'Invalid Ops user invitation',
      )
    }
    const parsed = result.data
    const principal = requireOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    const user = await this.mutationService.execute(
      principal,
      'administration.user.invite',
      { type: 'ops_user' },
      envelope,
      () => this.administrationService.inviteUser(parsed),
      result => ({ resourceId: result.id }),
    )
    this.setStatus(201)
    return user
  }

  @Get('audit')
  @OperationId('ListOpsAuditEvents')
  @Security('OpsAuth', ['administration:audit'])
  @SuccessResponse('200', 'Ops audit events retrieved')
  public async listAuditEvents(
    @Query() action?: string,
    @Query() actor?: string,
    @Query() createdFrom?: Date,
    @Query() createdTo?: Date,
    @Query() page: number = 1,
    @Query() pageSize: number = 50,
    @Query() resourceId?: string,
    @Query() resourceType?: string,
  ): Promise<OpsAuditListDto> {
    return this.administrationService.listAuditEvents({
      action: action?.trim() || undefined,
      actor: actor?.trim() || undefined,
      createdFrom,
      createdTo,
      page,
      pageSize,
      resourceId: resourceId?.trim() || undefined,
      resourceType: resourceType?.trim() || undefined,
    })
  }

  @Get('users')
  @OperationId('ListOpsUsers')
  @Security('OpsAuth', ['administration:users'])
  @SuccessResponse('200', 'Ops users retrieved')
  public async listUsers(): Promise<OpsUserListDto> {
    return this.administrationService.listUsers()
  }

  @OperationId('RevokeOpsUserSessions')
  @Post('users/{userId}/revoke-sessions')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:users'])
  @SuccessResponse('200', 'Ops user sessions revoked')
  public async revokeSessions(
    @Path() userId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsUserDto> {
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'administration.user.revoke_sessions',
      { id: userId, type: 'ops_user' },
      envelope,
      () => this.administrationService.revokeSessions(
        userId,
        envelope.expectedVersion ?? 0,
      ),
    )
  }

  @OperationId('UpdateOpsUserRole')
  @Patch('users/{userId}/role')
  @Response<400, { reason: string }>(400, 'Bad request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:users'])
  @SuccessResponse('200', 'Ops user role updated')
  public async updateRole(
    @Path() userId: string,
    @Body() body: OpsUserRoleUpdateInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsUserDto> {
    const result = opsUserRoleUpdateSchema.safeParse(body)
    if (!result.success) {
      throw new OpsAdministrationValidationError(
        result.error.issues[0]?.message ?? 'Invalid Ops role',
      )
    }
    const parsed = result.data
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'administration.user.role_update',
      { id: userId, type: 'ops_user' },
      envelope,
      () => this.administrationService.updateRole(
        userId,
        parsed.role,
        envelope.expectedVersion ?? 0,
      ),
    )
  }
}
