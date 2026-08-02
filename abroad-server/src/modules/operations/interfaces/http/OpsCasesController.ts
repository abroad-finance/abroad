/* eslint-disable perfectionist/sort-classes -- Tsoa preserves declaration order; static routes must precede dynamic resource routes. */
import type { Request as ExpressRequest } from 'express'

import { OpsNoteKind, OpsPriority, OpsWorkStatus } from '@prisma/client'
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
  OpsCaseCreateInput,
  OpsCaseDto,
  OpsCaseHandoffInput,
  OpsCaseListResponse,
  OpsCaseNoteInput,
  OpsCaseOwnerOptionDto,
  OpsCaseService,
  OpsCaseUpdateInput,
} from '../../application/OpsCaseService'
import { OpsMutationService } from '../../application/opsMutation'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

@Route('ops/cases')
export class OpsCasesController extends Controller {
  public constructor(
    @inject(OpsCaseService) private readonly caseService: OpsCaseService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @OperationId('OpsAddCaseNote')
  @Post('{caseId}/notes')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['cases:manage'])
  public async addNote(
    @Path() caseId: string,
    @Body() body: OpsCaseNoteInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsCaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      body.kind === OpsNoteKind.ESCALATION ? 'case.escalate' : 'case.note.add',
      { id: caseId, type: 'ops_case' },
      readOpsMutationEnvelope(request),
      transaction => this.caseService.addNote(principal, caseId, body, transaction),
    )
  }

  @OperationId('OpsCreateCase')
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['cases:manage'])
  @SuccessResponse('201', 'Operations case created')
  public async create(
    @Body() body: OpsCaseCreateInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsCaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'case.create',
      { id: body.transactionId, type: 'transaction' },
      readOpsMutationEnvelope(request),
      transaction => this.caseService.create(principal, body, transaction),
      result => ({ resourceId: result.id }),
    )
  }

  @OperationId('OpsHandoffCase')
  @Post('{caseId}/handoffs')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['cases:manage'])
  public async handoff(
    @Path() caseId: string,
    @Body() body: OpsCaseHandoffInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsCaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'case.handoff',
      { id: caseId, type: 'ops_case' },
      envelope,
      transaction => this.caseService.handoff(principal, caseId, body, envelope.expectedVersion ?? 0, transaction),
    )
  }

  @Get()
  @OperationId('OpsListCases')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['transactions:read'])
  public async list(
    @Request() request: ExpressRequest,
    @Query() status?: OpsWorkStatus,
    @Query() priority?: OpsPriority,
    @Query() ownerUserId?: string,
    @Query() team?: string,
    @Query() transactionId?: string,
    @Query() page?: number,
    @Query() pageSize?: number,
  ): Promise<OpsCaseListResponse> {
    return this.caseService.list(requireNamedOpsPrincipal(request.user), {
      ownerUserId,
      page,
      pageSize,
      priority,
      status,
      team,
      transactionId,
    })
  }

  @Get('owner-options')
  @OperationId('OpsListCaseOwnerOptions')
  @Security('OpsAuth', ['transactions:read'])
  public async listOwnerOptions(@Request() request: ExpressRequest): Promise<OpsCaseOwnerOptionDto[]> {
    return this.caseService.listOwners(requireNamedOpsPrincipal(request.user))
  }

  @Get('{caseId}')
  @OperationId('OpsGetCase')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['transactions:read'])
  public async getById(
    @Path() caseId: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsCaseDto> {
    return this.caseService.getById(requireNamedOpsPrincipal(request.user), caseId)
  }

  @OperationId('OpsUpdateCase')
  @Patch('{caseId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['cases:manage'])
  public async update(
    @Path() caseId: string,
    @Body() body: OpsCaseUpdateInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsCaseDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'case.update',
      { id: caseId, type: 'ops_case' },
      envelope,
      transaction => this.caseService.update(principal, caseId, body, envelope.expectedVersion ?? 0, transaction),
    )
  }
}
