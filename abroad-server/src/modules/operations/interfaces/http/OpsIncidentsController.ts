/* eslint-disable perfectionist/sort-classes -- Tsoa preserves declaration order; static routes must precede dynamic resource routes. */
import type { Request as ExpressRequest } from 'express'

import { OpsIncidentSeverity, OpsNoteKind, OpsWorkStatus } from '@prisma/client'
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
} from 'tsoa'

import { requireNamedOpsPrincipal, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import {
  OpsHandoffBoardDto,
  OpsHandoffScope,
  OpsIncidentDetailDto,
  OpsIncidentHandoffInput,
  OpsIncidentListResponse,
  OpsIncidentNoteInput,
  OpsIncidentOverviewDto,
  OpsIncidentOwnerOptionDto,
  OpsIncidentRunbookDto,
  OpsIncidentService,
  OpsIncidentUpdateInput,
} from '../../application/OpsIncidentService'
import { OpsMutationService } from '../../application/opsMutation'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

@Route('ops/incidents')
export class OpsIncidentsController extends Controller {
  public constructor(
    @inject(OpsIncidentService) private readonly incidentService: OpsIncidentService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  // Static routes intentionally precede `/{incidentId}` because Tsoa emits
  // declaration order into Express and a parameter route would otherwise
  // consume names such as "handoff" and "owner-options".
  @Get('handoff')
  @OperationId('OpsGetShiftHandoff')
  @Security('OpsAuth', ['incidents:read'])
  public async getHandoff(
    @Request() request: ExpressRequest,
    @Query() scope: OpsHandoffScope = 'ALL',
  ): Promise<OpsHandoffBoardDto> {
    return this.incidentService.getHandoffBoard(requireNamedOpsPrincipal(request.user), scope)
  }

  @Get('overview')
  @OperationId('OpsGetIncidentOverview')
  @Security('OpsAuth', ['incidents:read'])
  public async getOverview(@Request() request: ExpressRequest): Promise<OpsIncidentOverviewDto> {
    return this.incidentService.getOverview(requireNamedOpsPrincipal(request.user))
  }

  @Get('owner-options')
  @OperationId('OpsListIncidentOwnerOptions')
  @Security('OpsAuth', ['incidents:read'])
  public async listOwnerOptions(@Request() request: ExpressRequest): Promise<OpsIncidentOwnerOptionDto[]> {
    return this.incidentService.listOwners(requireNamedOpsPrincipal(request.user))
  }

  @Get('runbooks')
  @OperationId('OpsListIncidentRunbooks')
  @Security('OpsAuth', ['incidents:read'])
  public async listRunbooks(@Request() request: ExpressRequest): Promise<OpsIncidentRunbookDto[]> {
    return this.incidentService.listRunbooks(requireNamedOpsPrincipal(request.user))
  }

  @Get()
  @OperationId('OpsListIncidents')
  @Security('OpsAuth', ['incidents:read'])
  public async list(
    @Request() request: ExpressRequest,
    @Query() kind?: string,
    @Query() ownerUserId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
    @Query() query?: string,
    @Query() severity?: OpsIncidentSeverity,
    @Query() status?: OpsWorkStatus,
    @Query() team?: string,
    @Query() unowned?: boolean,
  ): Promise<OpsIncidentListResponse> {
    return this.incidentService.list(requireNamedOpsPrincipal(request.user), {
      kind,
      ownerUserId,
      page,
      pageSize,
      query,
      severity,
      status,
      team,
      unowned,
    })
  }

  @OperationId('OpsAddIncidentNote')
  @Post('{incidentId}/notes')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['incidents:manage'])
  public async addNote(
    @Path() incidentId: string,
    @Body() body: OpsIncidentNoteInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsIncidentDetailDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      body.kind === OpsNoteKind.ESCALATION ? 'incident.escalate' : 'incident.note.add',
      { id: incidentId, type: 'ops_incident' },
      readOpsMutationEnvelope(request),
      transaction => this.incidentService.addNote(principal, incidentId, body, transaction),
    )
  }

  @OperationId('OpsHandoffIncident')
  @Post('{incidentId}/handoffs')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['incidents:manage'])
  public async handoff(
    @Path() incidentId: string,
    @Body() body: OpsIncidentHandoffInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsIncidentDetailDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'incident.handoff',
      { id: incidentId, type: 'ops_incident' },
      envelope,
      transaction => this.incidentService.handoff(
        principal,
        incidentId,
        body,
        envelope.expectedVersion ?? 0,
        transaction,
      ),
    )
  }

  @Get('{incidentId}')
  @OperationId('OpsGetIncident')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['incidents:read'])
  public async getById(
    @Path() incidentId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsIncidentDetailDto> {
    return this.incidentService.getById(requireNamedOpsPrincipal(request.user), incidentId)
  }

  @OperationId('OpsUpdateIncident')
  @Patch('{incidentId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['incidents:manage'])
  public async update(
    @Path() incidentId: string,
    @Body() body: OpsIncidentUpdateInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsIncidentDetailDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'incident.update',
      { id: incidentId, type: 'ops_incident' },
      envelope,
      transaction => this.incidentService.update(
        principal,
        incidentId,
        body,
        envelope.expectedVersion ?? 0,
        transaction,
      ),
    )
  }
}
