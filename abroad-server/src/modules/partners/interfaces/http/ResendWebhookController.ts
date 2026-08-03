import { Request as ExpressRequest } from 'express'
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

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { PartnerPortalEmailDeliveryLifecycleService, ResendLifecycleEventType } from '../../application/PartnerPortalEmailDeliveryLifecycleService'
import { ResendWebhookSignatureError, ResendWebhookVerifier } from '../../infrastructure/ResendWebhookVerifier'

type RawBodyRequest = ExpressRequest & { rawBody?: Buffer }

const eventTypes = [
  'email.bounced',
  'email.complained',
  'email.delivered',
  'email.delivery_delayed',
  'email.failed',
  'email.sent',
  'email.suppressed',
] as const satisfies readonly ResendLifecycleEventType[]

const resendWebhookSchema = z.object({
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().trim().min(1).max(256),
  }).passthrough(),
  type: z.enum(eventTypes),
}).passthrough()

type WebhookErrorResponse = { message: string, success: false }
type WebhookSuccessResponse = { message: string, success: true }

@Hidden()
@Route('webhook/resend')
export class ResendWebhookController extends Controller {
  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(PartnerPortalEmailDeliveryLifecycleService)
    private readonly lifecycleService: PartnerPortalEmailDeliveryLifecycleService,
    @inject(ResendWebhookVerifier)
    private readonly webhookVerifier: ResendWebhookVerifier,
  ) {
    super()
  }

  @Post()
  @Response<WebhookErrorResponse>(400, 'Bad Request')
  @Response<WebhookErrorResponse>(401, 'Unauthorized')
  @Response<WebhookErrorResponse>(500, 'Internal Server Error')
  @SuccessResponse('200', 'Webhook processed')
  public async handle(
    @Body() _body: Record<string, unknown>,
    @Request() request: RawBodyRequest,
    @Res() badRequest: TsoaResponse<400, WebhookErrorResponse>,
    @Res() unauthorized: TsoaResponse<401, WebhookErrorResponse>,
    @Res() serverError: TsoaResponse<500, WebhookErrorResponse>,
  ): Promise<WebhookSuccessResponse> {
    try {
      if (!request.rawBody) {
        return unauthorized(401, { message: 'Invalid webhook signature', success: false })
      }
      const eventId = request.header('svix-id')
      const verifiedPayload = await this.webhookVerifier.verify({
        messageId: eventId,
        rawBody: request.rawBody,
        signature: request.header('svix-signature'),
        timestamp: request.header('svix-timestamp'),
      })
      const parsed = resendWebhookSchema.safeParse(verifiedPayload)
      if (!parsed.success || !eventId || eventId.length > 256) {
        this.logger.warn('Rejected invalid Resend webhook payload')
        return badRequest(400, { message: 'Invalid webhook payload', success: false })
      }
      await this.lifecycleService.recordWebhook({
        eventId,
        eventType: parsed.data.type,
        occurredAt: new Date(parsed.data.created_at),
        providerMessageId: parsed.data.data.email_id,
      })
      this.logger.info('Processed Resend email lifecycle webhook', {
        eventId,
        eventType: parsed.data.type,
        providerMessageId: parsed.data.data.email_id,
      })
      this.setStatus(200)
      return { message: 'Webhook processed', success: true }
    }
    catch (error) {
      if (error instanceof ResendWebhookSignatureError) {
        this.logger.warn('Rejected Resend webhook signature')
        return unauthorized(401, { message: 'Invalid webhook signature', success: false })
      }
      this.logger.error('Resend webhook processing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return serverError(500, { message: 'Internal server error', success: false })
    }
  }
}
