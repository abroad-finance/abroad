import { inject } from 'inversify'
import {
  Body,
  Controller,
  Hidden,
  OperationId,
  Post,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { ConsumerUxTelemetryRequest, ConsumerUxTelemetryResponse, parseConsumerUxTelemetry } from './consumerUxTelemetryContracts'

export const CONSUMER_UX_TELEMETRY_LOG_MESSAGE = '[ConsumerUxTelemetry] bounded UX event'

@Route('telemetry/consumer-ux')
@Security('ApiKeyAuth', ['telemetry:write'])
@Security('BearerAuth')
export class ConsumerUxTelemetryController extends Controller {
  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    super()
  }

  @Hidden()
  @OperationId('RecordConsumerUxTelemetry')
  @Post()
  @Response<400, { reason: string }>(400, 'Invalid telemetry event')
  @SuccessResponse('202', 'Telemetry event accepted')
  public async record(
    @Body() requestBody: ConsumerUxTelemetryRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<ConsumerUxTelemetryResponse> {
    const parsed = parseConsumerUxTelemetry(requestBody)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Invalid telemetry event' })
    }

    this.logger.info(CONSUMER_UX_TELEMETRY_LOG_MESSAGE, parsed.data)
    this.setStatus(202)
    return { accepted: true }
  }
}
