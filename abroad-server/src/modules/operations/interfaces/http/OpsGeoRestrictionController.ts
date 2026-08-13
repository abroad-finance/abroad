import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Patch,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { requireNamedOpsPrincipal, requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import {
  GEO_RESTRICTION_SETTING_ID,
  GeoRestrictionService,
  GeoRestrictionSettingDto,
  GeoRestrictionUpdateInput,
  GeoRestrictionValidationError,
} from '../../application/GeoRestrictionService'
import { OpsMutationService } from '../../application/opsMutation'
import { readOpsMutationEnvelope } from './opsMutationHeaders'

@Route('ops/configuration/geo-restriction')
export class OpsGeoRestrictionController extends Controller {
  public constructor(
    @inject(GeoRestrictionService)
    private readonly geoRestrictionService: GeoRestrictionService,
    @inject(OpsMutationService)
    private readonly mutationService: OpsMutationService,
  ) {
    super()
  }

  @Get()
  @OperationId('OpsGetGeoRestriction')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Security('OpsAuth', ['configuration:read'])
  @SuccessResponse('200', 'Region restriction retrieved')
  public async getSetting(
    @Request() request: ExpressRequest,
  ): Promise<GeoRestrictionSettingDto> {
    return this.geoRestrictionService.getSetting(requireNamedOpsPrincipal(request.user))
  }

  @OperationId('OpsUpdateGeoRestriction')
  @Patch()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @Response<409, { reason: string }>(409, 'Conflict')
  @Security('OpsAuth', ['configuration:manage'])
  @SuccessResponse('200', 'Region restriction updated')
  public async updateSetting(
    @Body() body: GeoRestrictionUpdateInput,
    @Request() request: ExpressRequest,
  ): Promise<GeoRestrictionSettingDto> {
    if (typeof body.enabled !== 'boolean') {
      throw new GeoRestrictionValidationError('enabled must be a boolean')
    }
    const enabled = body.enabled
    const principal = requireNamedOpsPrincipal(request.user)
    const envelope = readOpsMutationEnvelope(request)
    return this.mutationService.executeDatabase(
      requireOpsPrincipal(request.user),
      'configuration.geo_restriction.update',
      { id: GEO_RESTRICTION_SETTING_ID, type: 'geo_restriction_setting' },
      envelope,
      transaction => this.geoRestrictionService.updateSetting(
        principal,
        enabled,
        envelope.expectedVersion ?? 0,
        transaction,
      ),
      result => ({ metadata: { enabled: result.enabled } }),
    )
  }
}
