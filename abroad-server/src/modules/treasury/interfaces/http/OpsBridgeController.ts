import { inject } from 'inversify'
import {
  Controller,
  Get,
  Path,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsBridgeBatchDetailDto, OpsBridgeOverview, OpsBridgeService } from '../../application/OpsBridgeService'

@Route('ops/bridge')
@Security('OpsAuth', ['treasury:read'])
export class OpsBridgeController extends Controller {
  constructor(
    @inject(OpsBridgeService) private readonly opsBridgeService: OpsBridgeService,
  ) {
    super()
  }

  @Get('batches/{batchId}')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('200', 'Bridge batch detail retrieved')
  public async getBatchDetail(@Path() batchId: string): Promise<OpsBridgeBatchDetailDto> {
    return this.opsBridgeService.getBatchDetail(batchId)
  }

  @Get('overview')
  @SuccessResponse('200', 'Bridge overview retrieved')
  public async getOverview(): Promise<OpsBridgeOverview> {
    return this.opsBridgeService.getOverview()
  }
}
