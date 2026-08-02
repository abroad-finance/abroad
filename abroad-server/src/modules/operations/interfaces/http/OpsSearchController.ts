import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Controller,
  Get,
  OperationId,
  Query,
  Request,
  Response,
  Route,
  Security,
} from 'tsoa'

import { requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import { OpsGlobalSearchResponse, OpsGlobalSearchService } from '../../application/OpsGlobalSearchService'

@Route('ops/search')
export class OpsSearchController extends Controller {
  public constructor(
    @inject(OpsGlobalSearchService) private readonly searchService: OpsGlobalSearchService,
  ) {
    super()
  }

  @Get()
  @OperationId('OpsGlobalSearch')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['search:read'])
  public async search(
    @Query() query: string,
    @Request() request: ExpressRequest,
  ): Promise<OpsGlobalSearchResponse> {
    this.setHeader('Cache-Control', 'private, no-store')
    return this.searchService.search(requireOpsPrincipal(request.user), query)
  }
}
