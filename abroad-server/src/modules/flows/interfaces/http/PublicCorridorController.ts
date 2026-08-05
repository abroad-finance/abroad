import { FlowDirection } from '@prisma/client'
import { inject } from 'inversify'
import {
  Controller,
  Get,
  OperationId,
  Query,
  Route,
  SuccessResponse,
} from 'tsoa'

import { PublicCorridorResponse, PublicCorridorService } from '../../application/PublicCorridorService'

@Route('public/corridors')
export class PublicCorridorController extends Controller {
  constructor(
    @inject(PublicCorridorService) private readonly corridorService: PublicCorridorService,
  ) {
    super()
  }

  /**
   * @param direction Which way money moves. Defaults to payouts (`CRYPTO_TO_FIAT`)
   * so that clients written before the onramp existed are unaffected.
   */
  // Five controllers expose a method called `list`, so tsoa derives the same
  // `List` operation id for all of them. That is harmless until two of them
  // take parameters, at which point the generated client declares `ListParams`
  // twice and no longer compiles. Naming this one explicitly keeps the
  // generated types distinct.
  @Get()
  @OperationId('ListPublicCorridors')
  @SuccessResponse('200', 'Public corridor coverage retrieved')
  public async list(
    @Query() direction?: 'CRYPTO_TO_FIAT' | 'FIAT_TO_CRYPTO',
  ): Promise<PublicCorridorResponse> {
    return this.corridorService.list(
      direction === 'FIAT_TO_CRYPTO'
        ? FlowDirection.FIAT_TO_CRYPTO
        : FlowDirection.CRYPTO_TO_FIAT,
    )
  }
}
