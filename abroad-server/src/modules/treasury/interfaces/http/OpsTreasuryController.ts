import { inject } from 'inversify'
import {
  Controller,
  Get,
  Query,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsTreasuryBalancesResponse, OpsTreasuryMovementsResponse, OpsTreasuryService, OpsTreasurySnapshotsResponse } from '../../application/OpsTreasuryService'

@Route('ops/treasury')
@Security('OpsAuth', ['treasury:read'])
export class OpsTreasuryController extends Controller {
  constructor(
    @inject(OpsTreasuryService) private readonly opsTreasuryService: OpsTreasuryService,
  ) {
    super()
  }

  @Get('balances')
  @SuccessResponse('200', 'Treasury balances retrieved')
  public async getBalances(): Promise<OpsTreasuryBalancesResponse> {
    return this.opsTreasuryService.getBalances()
  }

  @Get('movements')
  @SuccessResponse('200', 'Treasury movements retrieved')
  public async getMovements(@Query() days?: number): Promise<OpsTreasuryMovementsResponse> {
    return this.opsTreasuryService.getMovements(days)
  }

  @Get('snapshots')
  @SuccessResponse('200', 'Treasury snapshots retrieved')
  public async getSnapshots(@Query() days?: number): Promise<OpsTreasurySnapshotsResponse> {
    return this.opsTreasuryService.getSnapshots(days)
  }
}
