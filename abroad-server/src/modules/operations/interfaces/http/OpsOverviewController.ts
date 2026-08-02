import { inject } from 'inversify'
import {
  Controller,
  Get,
  OperationId,
  Query,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsOverviewRange, OpsOverviewResponse, OpsOverviewService } from '../../application/OpsOverviewService'

@Route('ops/overview')
@Security('OpsAuth', ['overview:read'])
export class OpsOverviewController extends Controller {
  constructor(
    @inject(OpsOverviewService) private readonly overviewService: OpsOverviewService,
  ) {
    super()
  }

  @Get()
  @OperationId('OpsGetOverview')
  @SuccessResponse('200', 'Operations overview retrieved')
  public async getOverview(
    @Query() range: OpsOverviewRange = '7d',
  ): Promise<OpsOverviewResponse> {
    return this.overviewService.getOverview(range)
  }
}
