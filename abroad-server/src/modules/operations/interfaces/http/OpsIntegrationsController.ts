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
import {
  OpsIntegrationCatalogDto,
  OpsIntegrationDto,
  OpsIntegrationInput,
  OpsIntegrationService,
  OpsRunbookDto,
  OpsRunbookInput,
} from '../../application/OpsIntegrationService'
import { OpsMutationService } from '../../application/opsMutation'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

@Route('ops/integrations')
export class OpsIntegrationsController extends Controller {
  public constructor(
    @inject(OpsIntegrationService) private readonly integrationService: OpsIntegrationService,
    @inject(OpsMutationService) private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @OperationId('OpsCreateIntegration')
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:integrations'])
  @SuccessResponse('201', 'Integration created')
  public async createIntegration(
    @Body() body: OpsIntegrationInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsIntegrationDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'integration.create',
      { id: body.name, type: 'ops_integration' },
      readOpsMutationEnvelope(request),
      transaction => this.integrationService.createIntegration(principal, body, transaction),
      result => ({ resourceId: result.id }),
    )
  }

  @OperationId('OpsCreateRunbook')
  @Post('runbooks')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:integrations'])
  @SuccessResponse('201', 'Runbook created')
  public async createRunbook(
    @Body() body: OpsRunbookInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsRunbookDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'runbook.create',
      { id: body.slug, type: 'ops_runbook' },
      readOpsMutationEnvelope(request),
      transaction => this.integrationService.createRunbook(principal, body, transaction),
      result => ({ resourceId: result.id }),
    )
  }

  @Get()
  @OperationId('OpsGetIntegrationCatalog')
  @Security('OpsAuth', ['incidents:read'])
  public async getCatalog(@Request() request: ExpressRequest): Promise<OpsIntegrationCatalogDto> {
    return this.integrationService.getCatalog(requireNamedOpsPrincipal(request.user))
  }

  @OperationId('OpsUpdateIntegration')
  @Patch('{integrationId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:integrations'])
  public async updateIntegration(
    @Path() integrationId: string,
    @Body() body: OpsIntegrationInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsIntegrationDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'integration.update',
      { id: integrationId, type: 'ops_integration' },
      envelope,
      transaction => this.integrationService.updateIntegration(
        principal,
        integrationId,
        body,
        envelope.expectedVersion ?? 0,
        transaction,
      ),
    )
  }

  @OperationId('OpsUpdateRunbook')
  @Patch('runbooks/{runbookId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['administration:integrations'])
  public async updateRunbook(
    @Path() runbookId: string,
    @Body() body: OpsRunbookInput,
    @Request() request: ExpressRequest,
  ): Promise<OpsRunbookDto> {
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'runbook.update',
      { id: runbookId, type: 'ops_runbook' },
      envelope,
      transaction => this.integrationService.updateRunbook(
        principal,
        runbookId,
        body,
        envelope.expectedVersion ?? 0,
        transaction,
      ),
    )
  }
}
