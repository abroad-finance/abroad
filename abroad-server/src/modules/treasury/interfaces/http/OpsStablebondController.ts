import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Post,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsMutationService } from '../../../operations/application/opsMutation'
import { readOpsMutationEnvelope } from '../../../operations/interfaces/http/opsMutationHeaders'
import {
  OpsStablebondAcquireInput,
  OpsStablebondResponse,
  OpsStablebondService,
  OpsStablebondTrustlineDto,
  OpsStablebondUnwindInput,
  OpsStablebondUnwindResultDto,
} from '../../application/OpsStablebondService'

@Route('ops/treasury/stablebond')
export class OpsStablebondController extends Controller {
  public constructor(
    @inject(OpsStablebondService) private readonly stablebondService: OpsStablebondService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  /**
   * Not `executeDatabase`: acquiring talks to a public venue over the network,
   * and an open Serializable transaction must never span an external call.
   */
  @OperationId('OpsAcquireStablebondPosition')
  @Post('acquisitions')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['treasury:manage'])
  @SuccessResponse('200', 'Stablebond acquisition executed')
  public async acquire(
    @Body() body: OpsStablebondAcquireInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsStablebondUnwindResultDto> {
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'treasury.stablebond.acquire',
      { type: 'stablebond_position' },
      envelope,
      () => this.stablebondService.acquire(body, envelope.idempotencyKey),
      result => ({ resourceId: result.executionId ?? undefined }),
    )
  }

  @Get()
  @OperationId('OpsGetStablebondPosition')
  @Security('OpsAuth', ['treasury:read'])
  @SuccessResponse('200', 'Stablebond position retrieved')
  public async getOverview(): Promise<OpsStablebondResponse> {
    return this.stablebondService.getOverview()
  }

  @OperationId('OpsOpenStablebondTrustline')
  @Post('trustline')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['treasury:manage'])
  @SuccessResponse('200', 'Stablebond trustline ensured')
  public async openTrustline(@Request() request: ExpressRequest): Promise<OpsStablebondTrustlineDto> {
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'treasury.stablebond.open_trustline',
      { type: 'stablebond_position' },
      readOpsMutationEnvelope(request),
      () => this.stablebondService.openTrustline(),
    )
  }

  @OperationId('OpsRegisterStablebondBasis')
  @Post('basis')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['treasury:manage'])
  @SuccessResponse('200', 'Stablebond basis registered')
  public async registerBasis(@Request() request: ExpressRequest): Promise<OpsStablebondResponse> {
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'treasury.stablebond.register_basis',
      { type: 'stablebond_position' },
      readOpsMutationEnvelope(request),
      () => this.stablebondService.registerBasis(),
    )
  }

  /**
   * Not `executeDatabase`: an unwind talks to a public venue over the network,
   * and an open Serializable transaction must never span an external call.
   */
  @OperationId('OpsUnwindStablebondPosition')
  @Post('unwinds')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['treasury:manage'])
  @SuccessResponse('200', 'Stablebond unwind executed')
  public async unwind(
    @Body() body: OpsStablebondUnwindInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsStablebondUnwindResultDto> {
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.execute(
      requireOpsPrincipal(request.user),
      'treasury.stablebond.unwind',
      { type: 'stablebond_position' },
      envelope,
      // The operator's own idempotency key becomes the unwind's, so a retried
      // request re-attaches to the execution already in flight instead of
      // selling a second time.
      () => this.stablebondService.unwind(body, envelope.idempotencyKey),
      result => ({ resourceId: result.executionId ?? undefined }),
    )
  }
}
