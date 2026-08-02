import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Patch,
  Path,
  Post,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsConfigurationReleaseRequiredError } from '../../../operations/application/OpsConfigurationGovernance'
import { FlowDefinitionDto, FlowDefinitionInput, FlowDefinitionUpdateInput } from '../../application/flowDefinitionSchemas'
import { FlowDefinitionService } from '../../application/FlowDefinitionService'

@Route('ops/flows/definitions')
export class FlowDefinitionController extends Controller {
  constructor(
    @inject(FlowDefinitionService) private readonly flowDefinitionService: FlowDefinitionService,
  ) {
    super()
  }

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Configuration release required')
  @Security('OpsAuth', ['configuration:manage'])
  public async create(
    @Body() _body: FlowDefinitionInput,
  ): Promise<FlowDefinitionDto> {
    void _body
    throw new OpsConfigurationReleaseRequiredError()
  }

  @Get()
  @Security('OpsAuth', ['configuration:read'])
  @SuccessResponse('200', 'Flow definitions retrieved')
  public async list(): Promise<FlowDefinitionDto[]> {
    return this.flowDefinitionService.list()
  }

  @OperationId('FlowDefinitionUpdate')
  @Patch('{flowId}')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Configuration release required')
  @Security('OpsAuth', ['configuration:manage'])
  public async update(
    @Path('flowId') _flowId: string,
    @Body() _body: FlowDefinitionUpdateInput,
  ): Promise<FlowDefinitionDto> {
    void _flowId
    void _body
    throw new OpsConfigurationReleaseRequiredError()
  }
}
