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
import { parsePixCheckoutTelemetry, PixCheckoutTelemetryRequest, PixCheckoutTelemetryResponse } from './pixCheckoutTelemetryContracts'

export const PIX_CHECKOUT_TELEMETRY_LOG_MESSAGE = '[PixCheckoutTelemetry] PIX checkout funnel event'

@Route('telemetry/pix-checkout')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class PixCheckoutTelemetryController extends Controller {
  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    super()
  }

  @Hidden()
  @OperationId('RecordPixCheckoutTelemetry')
  @Post()
  @Response<400, { reason: string }>(400, 'Invalid telemetry event')
  @SuccessResponse('202', 'Telemetry event accepted')
  public async record(
    @Body() requestBody: PixCheckoutTelemetryRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<PixCheckoutTelemetryResponse> {
    const parsed = parsePixCheckoutTelemetry(requestBody)
    if (!parsed.success) {
      return badRequest(400, { reason: 'Invalid telemetry event' })
    }

    this.logger.info(PIX_CHECKOUT_TELEMETRY_LOG_MESSAGE, parsed.data)
    this.setStatus(202)
    return { accepted: true }
  }
}
