import { TargetCurrency } from '@prisma/client'
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
import { z } from 'zod'

import { ILogger, IQueueHandler, PaymentStatusUpdatedMessage, QueueName } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { PersonaWebhookService } from '../services/webhooks/PersonaWebhookService'
import { WebhookProcessingResult } from '../services/webhooks/types'
import { TYPES } from '../types'

type WebhookResponse = {
  message?: string
  success: boolean
}

@Route('webhook')
export class WebhookController extends Controller {
  private readonly personaWebhookService: PersonaWebhookService
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private logger: ILogger,
    @inject(TYPES.IQueueHandler)
    private queueHandler: IQueueHandler,
  ) {
    super()
    this.personaWebhookService = new PersonaWebhookService(this.dbProvider, this.logger, this.queueHandler)
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

      // Validate minimum fields from provided example
      const schema = z.object({
        Amount: z.number().optional(),
        Currency: z.enum(TargetCurrency),
        PaymentId: z.string().min(1),
        PaymentStatus: z.string().min(1),
      }).loose()

      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        this.logger.warn('Invalid Transfero webhook payload', {
          errors: JSON.stringify(parsed.error.issues),
        })
        return badRequest(400, { message: 'Invalid webhook payload', success: false })
      }

      const { Amount, Currency, PaymentId, PaymentStatus } = parsed.data as z.output<typeof schema>

      // Publish a normalized message to the queue for async processing
      await this.queueHandler.postMessage(QueueName.PAYMENT_STATUS_UPDATED, {
        amount: typeof Amount === 'number' ? Amount : 0,
        currency: Currency ?? 'BRL',
        externalId: PaymentId,
        provider: 'transfero',
        status: PaymentStatus,
      } satisfies PaymentStatusUpdatedMessage)
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
