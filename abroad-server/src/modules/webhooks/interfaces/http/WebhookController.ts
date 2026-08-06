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

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { TransferoUltraWebhookSignatureError, TransferoUltraWebhookVerifier } from '../../../transfero/infrastructure/TransferoUltraWebhookVerifier'
import { parseTransferoWebhook } from './transferoWebhookValidator'
import { WebhookResponse } from './types'

export type RawBodyRequest = ExpressRequest & {
  rawBody?: Buffer
}

@Route('webhook')
export class WebhookController extends Controller {
  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TransferoUltraWebhookVerifier)
    private readonly transferoWebhookVerifier: TransferoUltraWebhookVerifier,
  ) {
    super()
  }

  @Hidden()
  @Post('transfero')
  @Response('400', 'Bad Request - Invalid payload')
  @Response('401', 'Unauthorized - Invalid signature')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Webhook processed successfully')
  public async handleTransferoWebhook(
    @Body() body: Record<string, unknown>,
    @Request() request: RawBodyRequest,
    @Res() badRequest: TsoaResponse<400, { message: string, success: false }>,
    @Res() unauthorized: TsoaResponse<401, { message: string, success: false }>,
    @Res() serverError: TsoaResponse<500, { message: string, success: false }>,
  ): Promise<WebhookResponse> {
    try {
      if (!request.rawBody) {
        return unauthorized(401, {
          message: 'Invalid webhook signature',
          success: false,
        })
      }
      await this.transferoWebhookVerifier.verify({
        rawBody: request.rawBody,
        signatureHeader: request.header('x-ultra-signature'),
      })

      const validation = parseTransferoWebhook(body)
      if (!validation.success) {
        this.logger.warn('Invalid Transfero Ultra webhook payload', {
          errors: validation.errors,
        })
        return badRequest(400, {
          message: 'Invalid webhook payload',
          success: false,
        })
      }

      const headerEventType = request.header('x-ultra-webhook-event')
      if (headerEventType && headerEventType !== validation.action.eventType) {
        this.logger.warn('Transfero Ultra webhook event header mismatch', {
          bodyEventType: validation.action.eventType,
          headerEventType,
        })
        return badRequest(400, {
          message: 'Invalid webhook payload',
          success: false,
        })
      }

      this.logger.info('Received verified Transfero Ultra webhook', {
        attempt: validation.attempt,
        eventId: validation.action.eventId,
        eventType: validation.action.eventType,
      })
      await this.dispatchAction(validation.action)

      this.setStatus(200)
      return { message: 'Webhook processed successfully', success: true }
    }
    catch (error) {
      if (error instanceof TransferoUltraWebhookSignatureError) {
        this.logger.warn('Rejected Transfero Ultra webhook signature', {
          reason: error.message,
        })
        return unauthorized(401, {
          message: 'Invalid webhook signature',
          success: false,
        })
      }

      this.logger.error('Error processing Transfero Ultra webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      return serverError(500, {
        message: 'Internal server error',
        success: false,
      })
    }
  }

  private async dispatchAction(
    action: Extract<
      ReturnType<typeof parseTransferoWebhook>,
      { success: true }
    >['action'],
  ): Promise<void> {
    switch (action.action) {
      case 'credit-failed':
        this.logger.error('Transfero Ultra crypto deposit credit failed', {
          asset: action.asset,
          blockchain: action.blockchain,
          eventId: action.eventId,
          failureReason: action.failureReason,
          transactionId: action.transactionId,
        })
        return
      case 'exchange-balance-updated':
        await this.queueHandler.postMessage(
          QueueName.EXCHANGE_BALANCE_UPDATED,
          { provider: 'transfero', trigger: 'observed' },
        )
        return
      case 'fiat-deposit-received':
        await this.queueHandler.postMessage(
          QueueName.FIAT_DEPOSIT_RECEIVED,
          action.message,
        )
        return
      case 'payment-status-updated':
        await this.queueHandler.postMessage(
          QueueName.PAYMENT_STATUS_UPDATED,
          action.message,
        )
        return
      case 'ignored':
        this.logger.info('Ignored unconfigured Transfero Ultra webhook event', {
          eventId: action.eventId,
          eventType: action.eventType,
        })
    }
  }
}
