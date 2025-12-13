import { Request as RequestExpress } from 'express'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Hidden,
  Post,
  Request,
  Res,
  Response,
  Route,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { PersonaWebhookService } from '../../application/PersonaWebhookService'
import { WebhookProcessingResult } from '../../application/types'
import { parseTransferoWebhook } from './transferoWebhookValidator'
import { WebhookResponse } from './types'

@Route('webhook')
export class WebhookController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private logger: ILogger,
    @inject(TYPES.IQueueHandler)
    private queueHandler: IQueueHandler,
    @inject(PersonaWebhookService)
    private readonly personaWebhookService: PersonaWebhookService,
  ) {
    super()
  }

  /**
   * Handle Persona webhook notifications for KYC inquiry updates
   *
   * Notes:
   * - If PERSONA_WEBHOOK_SECRET is set, we verify the HMAC signature header.
   * - We try to match PartnerUserKyc.externalId by Persona inquiry id (data.id)
   *   and, if present, by attributes.reference_id (in case you store that instead).
   */
  @Hidden()
  @Post('persona')
  @Response('400', 'Bad Request - Invalid payload or signature')
  @Response('404', 'Not Found - KYC session not found')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Webhook processed successfully')
  public async handlePersonaWebhook(
    @Body() body: Record<string, unknown>,
    @Request() request: RequestExpress & { rawBody?: string }, // rawBody required for signature verification
    @Res() badRequest: TsoaResponse<400, { message: string, success: false }>,
    @Res() notFound: TsoaResponse<404, { message: string, success: false }>,
    @Res() serverError: TsoaResponse<500, { message: string, success: false }>,
  ): Promise<WebhookResponse> {
    const result = await this.personaWebhookService.processWebhook(body, request)
    return this.resolveWebhookResponse(result, badRequest, notFound, serverError)
  }

  /**
   * Handle payment status webhook notifications from Transfero
   * Accepts the provider payload and forwards a normalized message to a queue.
   */
  @Hidden()
  @Post('transfero')
  @Response('400', 'Bad Request - Invalid payload')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Webhook processed successfully')
  public async handleTransferoWebhook(
    @Body() body: Record<string, unknown>,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { message: string, success: false }>,
    @Res() serverError: TsoaResponse<500, { message: string, success: false }>,
  ): Promise<WebhookResponse> {
    try {
      this.logger.info('Received Transfero webhook', {
        headers: request.headers,
        payload: body,
      })

      const validation = parseTransferoWebhook(body)
      if (!validation.success) {
        this.logger.warn('Invalid Transfero webhook payload', { errors: validation.errors })
        return badRequest(400, { message: 'Invalid webhook payload', success: false })
      }

      await this.queueHandler.postMessage(QueueName.PAYMENT_STATUS_UPDATED, validation.message)
      this.setStatus(200)
      return { message: 'Webhook processed successfully', success: true }
    }
    catch (error) {
      this.logger.error('Error processing Transfero webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: body,
        stack: error instanceof Error ? error.stack : undefined,
      })
      return serverError(500, {
        message: 'Internal server error',
        success: false,
      })
    }
  }

  private resolveWebhookResponse(
    result: WebhookProcessingResult,
    badRequest: TsoaResponse<400, { message: string, success: false }>,
    notFound: TsoaResponse<404, { message: string, success: false }>,
    serverError: TsoaResponse<500, { message: string, success: false }>,
  ): WebhookResponse {
    if (result.status === 'bad_request') {
      return badRequest(400, result.payload)
    }

    if (result.status === 'not_found') {
      return notFound(404, result.payload)
    }

    if (result.status === 'error') {
      return serverError(500, result.payload)
    }

    this.setStatus(200)
    return result.payload
  }
}
