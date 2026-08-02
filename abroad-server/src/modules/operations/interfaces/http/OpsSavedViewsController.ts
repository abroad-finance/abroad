import type { Request as ExpressRequest } from 'express'

import { OpsSavedViewResource } from '@prisma/client'
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
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { requireNamedOpsPrincipal, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsMutationService } from '../../application/opsMutation'
import { OpsSavedViewCreateInput, OpsSavedViewDto, OpsSavedViewService, OpsSavedViewUpdateInput } from '../../application/OpsSavedViewService'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

@Route('ops/saved-views')
export class OpsSavedViewsController extends Controller {
  public constructor(
    @inject(OpsSavedViewService) private readonly savedViewService: OpsSavedViewService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @OperationId('OpsCreateSavedView')
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['saved_views:manage'])
  @SuccessResponse('201', 'Saved view created')
  public async create(
    @Body() body: OpsSavedViewCreateInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsSavedViewDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'saved_view.create',
      { type: 'saved_view' },
      readOpsMutationEnvelope(request),
      transaction => this.savedViewService.create(principal, body, transaction),
      result => ({ resourceId: result.id }),
    )
  }

  @Delete('{viewId}')
  @OperationId('OpsDeleteSavedView')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['saved_views:manage'])
  public async delete(
    @Path() viewId: string,
    @Request() request: ExpressRequest,
  ): Promise<{ id: string }> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'saved_view.delete',
      { id: viewId, type: 'saved_view' },
      envelope,
      transaction => this.savedViewService.delete(principal, viewId, envelope.expectedVersion ?? 0, transaction),
    )
  }

  @Get()
  @OperationId('OpsListSavedViews')
  @Security('OpsAuth', ['transactions:read'])
  public async list(
    @Request() request: ExpressRequest,
    @Query() resource?: OpsSavedViewResource,
  ): Promise<OpsSavedViewDto[]> {
    return this.savedViewService.list(requireNamedOpsPrincipal(request.user), resource)
  }

  @OperationId('OpsUpdateSavedView')
  @Patch('{viewId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['saved_views:manage'])
  public async update(
    @Path() viewId: string,
    @Body() body: OpsSavedViewUpdateInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsSavedViewDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'saved_view.update',
      { id: viewId, type: 'saved_view' },
      envelope,
      transaction => this.savedViewService.update(principal, viewId, body, envelope.expectedVersion ?? 0, transaction),
    )
  }
}
