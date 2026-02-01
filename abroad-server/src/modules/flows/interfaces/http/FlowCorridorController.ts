import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Patch,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { FlowCorridorService } from '../../application/FlowCorridorService'
import {
  FlowCorridorDto,
  FlowCorridorListDto,
  FlowCorridorUpdateInput,
  flowCorridorUpdateSchema,
} from '../../application/flowDefinitionSchemas'

@Route('ops/flows/corridors')
@Security('OpsApiKeyAuth')
export class FlowCorridorController extends Controller {
  constructor(
    @inject(FlowCorridorService) private readonly corridorService: FlowCorridorService,
  ) {
    super()
  }

  @Get()
  @SuccessResponse('200', 'Flow corridor coverage retrieved')
  public async list(): Promise<FlowCorridorListDto> {
    return this.corridorService.list()
  }

  @Patch()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Flow corridor updated')
  public async update(
    @Body() body: FlowCorridorUpdateInput,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<FlowCorridorDto> {
    const parsed = flowCorridorUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.message })
    }

    return this.corridorService.updateStatus(parsed.data)
  }
}
