import type { Request as ExpressRequest } from 'express'

import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { requireOpsPrincipal } from '../../../../app/http/authenticationContext'
import {
  OpsTaskTelemetryInput,
  opsTaskTelemetryInputSchema,
  OpsTaskTelemetryService,
  OpsTaskTelemetrySummary,
  OpsTaskTelemetryValidationError,
} from '../../application/OpsTaskTelemetryService'

@Route('ops/task-events')
export class OpsTaskTelemetryController extends Controller {
  public constructor(
    @inject(OpsTaskTelemetryService)
    private readonly telemetryService: OpsTaskTelemetryService,
  ) {
    super()
  }

  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['overview:read'])
  @SuccessResponse('204', 'Task event accepted')
  public async record(
    @Body() body: OpsTaskTelemetryInput,
    @Request() request: ExpressRequest,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<void> {
    const parsed = opsTaskTelemetryInputSchema.safeParse(body)
    if (!parsed.success) {
      badRequest(400, { reason: parsed.error.issues[0]?.message ?? 'Invalid task event' })
      return
    }
    await this.telemetryService.record(requireOpsPrincipal(request.user), parsed.data)
    this.setStatus(204)
  }

  @Get('summary')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('OpsAuth', ['administration:audit'])
  public async summary(
    @Query() createdFrom: string,
    @Query() createdTo: string,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<OpsTaskTelemetrySummary> {
    try {
      return await this.telemetryService.summarize(
        new Date(createdFrom),
        new Date(createdTo),
      )
    }
    catch (error) {
      if (error instanceof OpsTaskTelemetryValidationError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
