import { inject } from 'inversify'
import {
  Controller,
  Get,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsBridgeOverview, OpsBridgeService } from '../../application/OpsBridgeService'

@Route('ops/bridge')
@Security('OpsApiKeyAuth')
export class OpsBridgeController extends Controller {
  constructor(
    @inject(OpsBridgeService) private readonly opsBridgeService: OpsBridgeService,
  ) {
    super()
  }

  @Get('overview')
  @SuccessResponse('200', 'Bridge overview retrieved')
  public async getOverview(): Promise<OpsBridgeOverview> {
    return this.opsBridgeService.getOverview()
  }
}
