import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Patch,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsConfigurationReleaseRequiredError } from '../../../operations/application/OpsConfigurationGovernance'
import { FlowCorridorService } from '../../application/FlowCorridorService'
import { FlowCorridorDto, FlowCorridorListDto, FlowCorridorUpdateInput } from '../../application/flowDefinitionSchemas'

@Route('ops/flows/corridors')
export class FlowCorridorController extends Controller {
  constructor(
    @inject(FlowCorridorService) private readonly corridorService: FlowCorridorService,
  ) {
    super()
  }

  @Get()
  @Security('OpsAuth', ['configuration:read'])
  @SuccessResponse('200', 'Flow corridor coverage retrieved')
  public async list(): Promise<FlowCorridorListDto> {
    return this.corridorService.list()
  }

  @OperationId('FlowCorridorUpdate')
  @Patch()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Configuration release required')
  @Security('OpsAuth', ['configuration:manage'])
  public async update(
    @Body() _body: FlowCorridorUpdateInput,
  ): Promise<FlowCorridorDto> {
    void _body
    throw new OpsConfigurationReleaseRequiredError()
  }
}
