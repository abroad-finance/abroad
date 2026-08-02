/* eslint-disable perfectionist/sort-classes -- Tsoa preserves declaration order; collection routes must precede dynamic routes. */
import type { Request as ExpressRequest } from 'express'

import { OpsConfigurationReleaseStatus, OpsConfigurationTargetType } from '@prisma/client'
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
  OpsConfigurationDraftInput,
  OpsConfigurationPayload,
  OpsConfigurationReleaseDto,
  OpsConfigurationReleaseList,
  OpsConfigurationReleaseService,
  OpsConfigurationReleaseValidationError,
} from '../../application/OpsConfigurationReleaseService'
import { OpsMutationService } from '../../application/opsMutation'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

export type OpsConfigurationDraftHttpInput = {
  effectiveAt?: string
  payload: OpsConfigurationPayload
  title: string
}

export type OpsConfigurationRejectInput = {
  rejectionReason: string
}

const toDraftInput = (body: OpsConfigurationDraftHttpInput): OpsConfigurationDraftInput => {
  if (!body.effectiveAt) return { payload: body.payload, title: body.title }
  const effectiveAt = new Date(body.effectiveAt)
  if (!Number.isFinite(effectiveAt.getTime())) {
    throw new OpsConfigurationReleaseValidationError('Effective time must be a valid ISO date and time')
  }
  return { effectiveAt, payload: body.payload, title: body.title }
}

@Route('ops/configuration-releases')
export class OpsConfigurationReleaseController extends Controller {
  public constructor(
    @inject(OpsConfigurationReleaseService)
    private readonly releaseService: OpsConfigurationReleaseService,
    @inject(OpsMutationService)
    private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @OperationId('OpsCreateConfigurationRelease')
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:manage'])
  @SuccessResponse('201', 'Configuration release draft created')
  public async create(
    @Body() body: OpsConfigurationDraftHttpInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsConfigurationReleaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'configuration.release.create',
      { type: 'ops_configuration_release' },
      envelope,
      () => this.releaseService.createDraft(principal, toDraftInput(body), envelope),
      result => ({ resourceId: result.id }),
    )
  }

  @Get()
  @OperationId('OpsListConfigurationReleases')
  @Security('OpsAuth', ['configuration:read'])
  public async list(
    @Query() page = 1,
    @Query() pageSize = 25,
    @Query() query?: string,
    @Query() status?: OpsConfigurationReleaseStatus,
    @Query() targetType?: OpsConfigurationTargetType,
  ): Promise<OpsConfigurationReleaseList> {
    return this.releaseService.list({ page, pageSize, query, status, targetType })
  }

  @Get('{releaseId}')
  @OperationId('OpsGetConfigurationRelease')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['configuration:read'])
  public async get(@Path() releaseId: string): Promise<OpsConfigurationReleaseDto> {
    return this.releaseService.get(releaseId)
  }

  @OperationId('OpsUpdateConfigurationRelease')
  @Patch('{releaseId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:manage'])
  public async update(
    @Path() releaseId: string,
    @Body() body: OpsConfigurationDraftHttpInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsConfigurationReleaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'configuration.release.update',
      { id: releaseId, type: 'ops_configuration_release' },
      envelope,
      () => this.releaseService.updateDraft(
        releaseId,
        principal,
        envelope.expectedVersion ?? 0,
        toDraftInput(body),
        envelope,
      ),
    )
  }

  @OperationId('OpsSubmitConfigurationRelease')
  @Post('{releaseId}/submit')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:manage'])
  public async submit(
    @Path() releaseId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsConfigurationReleaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'configuration.release.submit',
      { id: releaseId, type: 'ops_configuration_release' },
      envelope,
      () => this.releaseService.submit(releaseId, principal, envelope.expectedVersion ?? 0),
    )
  }

  @OperationId('OpsApproveConfigurationRelease')
  @Post('{releaseId}/approve')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:approve'])
  public async approve(
    @Path() releaseId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsConfigurationReleaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'configuration.release.approve',
      { id: releaseId, type: 'ops_configuration_release' },
      envelope,
      () => this.releaseService.approve(releaseId, principal, envelope.expectedVersion ?? 0),
    )
  }

  @OperationId('OpsRejectConfigurationRelease')
  @Post('{releaseId}/reject')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:approve'])
  public async reject(
    @Path() releaseId: string,
    @Body() body: OpsConfigurationRejectInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsConfigurationReleaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'configuration.release.reject',
      { id: releaseId, type: 'ops_configuration_release' },
      envelope,
      () => this.releaseService.reject(
        releaseId,
        principal,
        envelope.expectedVersion ?? 0,
        body.rejectionReason,
      ),
    )
  }

  @OperationId('OpsCreateConfigurationRollback')
  @Post('{releaseId}/rollback')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:manage'])
  @SuccessResponse('201', 'Rollback draft created')
  public async rollback(
    @Path() releaseId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsConfigurationReleaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'configuration.release.rollback',
      { id: releaseId, type: 'ops_configuration_release' },
      envelope,
      () => this.releaseService.createRollbackDraft(
        principal,
        releaseId,
        envelope.expectedVersion ?? 0,
        envelope,
      ),
      result => ({ resourceId: result.id }),
    )
  }
}
