import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Patch,
  Path,
  Post,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { FlowDefinitionDto, FlowDefinitionInput, flowDefinitionSchema, FlowDefinitionUpdateInput } from '../../application/flowDefinitionSchemas'
import { FlowDefinitionService, FlowDefinitionValidationError } from '../../application/FlowDefinitionService'

@Route('ops/flows/definitions')
@Security('OpsApiKeyAuth')
export class FlowDefinitionController extends Controller {
  constructor(
    @inject(FlowDefinitionService) private readonly flowDefinitionService: FlowDefinitionService,
  ) {
    super()
  }

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('201', 'Flow definition created')
  public async create(
    @Body() body: FlowDefinitionInput,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<FlowDefinitionDto> {
    const parsed = flowDefinitionSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.message })
    }

    try {
      const created = await this.flowDefinitionService.create(parsed.data)
      this.setStatus(201)
      return created
    }
    catch (error) {
      if (error instanceof FlowDefinitionValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }

  @Get()
  @SuccessResponse('200', 'Flow definitions retrieved')
  public async list(): Promise<FlowDefinitionDto[]> {
    return this.flowDefinitionService.list()
  }

  @OperationId('FlowDefinitionUpdate')
  @Patch('{flowId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Flow definition updated')
  public async update(
    @Path() flowId: string,
    @Body() body: FlowDefinitionUpdateInput,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<FlowDefinitionDto> {
    const parsed = flowDefinitionSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.message })
    }

    try {
      return await this.flowDefinitionService.update(flowId, parsed.data)
    }
    catch (error) {
      if (error instanceof FlowDefinitionValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
