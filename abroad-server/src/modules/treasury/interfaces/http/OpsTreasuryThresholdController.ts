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
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { requireNamedOpsPrincipal, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import { OpsTreasuryThresholdDto, OpsTreasuryThresholdInput, OpsTreasuryThresholdService } from '../../application/OpsTreasuryThresholdService'

@Route('ops/treasury/thresholds')
export class OpsTreasuryThresholdController extends Controller {
  public constructor(
    @inject(OpsTreasuryThresholdService)
    private readonly thresholdService: OpsTreasuryThresholdService,
    @inject(OpsMutationService)
    private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @OperationId('OpsCreateTreasuryThreshold')
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['treasury:manage'])
  @SuccessResponse('201', 'Treasury threshold created')
  public async create(
    @Body() body: OpsTreasuryThresholdInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsTreasuryThresholdDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'treasury.threshold.create',
      { id: `${body.venue}:${body.currency}`, type: 'ops_treasury_threshold' },
      readOpsMutationEnvelope(request),
      transaction => this.thresholdService.create(principal, body, transaction),
      result => ({ resourceId: result.id }),
    )
  }

  @Get()
  @OperationId('OpsListTreasuryThresholds')
  @Security('OpsAuth', ['treasury:read'])
  public async list(@Request() request: ExpressRequest): Promise<OpsTreasuryThresholdDto[]> {
    return this.thresholdService.list(requireNamedOpsPrincipal(request.user))
  }

  @OperationId('OpsUpdateTreasuryThreshold')
  @Patch('{thresholdId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['treasury:manage'])
  public async update(
    @Path() thresholdId: string,
    @Body() body: OpsTreasuryThresholdInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsTreasuryThresholdDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'treasury.threshold.update',
      { id: thresholdId, type: 'ops_treasury_threshold' },
      envelope,
      transaction => this.thresholdService.update(
        principal,
        thresholdId,
        body,
        envelope.expectedVersion ?? 0,
        transaction,
      ),
    )
  }
}
