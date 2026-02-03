import { inject } from 'inversify'
import { Controller, Get, Route, SuccessResponse } from 'tsoa'

import { PublicCorridorResponse, PublicCorridorService } from '../../application/PublicCorridorService'

@Route('public/corridors')
export class PublicCorridorController extends Controller {
  constructor(
    @inject(PublicCorridorService) private readonly corridorService: PublicCorridorService,
  ) {
    super()
  }

  @Get()
  @SuccessResponse('200', 'Public corridor coverage retrieved')
  public async list(): Promise<PublicCorridorResponse> {
    return this.corridorService.list()
  }
}
