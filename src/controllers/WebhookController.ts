import { KycStatus, TargetCurrency } from '@prisma/client'
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
import { TYPES } from '../types'

// Guardline webhook payload validation schema
const guardlineWebhookSchema = z.object({
  workflow_instance_id: z.string().min(1).optional(),
}).loose() // Allow excess properties

export interface GuardlineWebhookRequest {
  [key: string]: unknown // Allow excess properties
  workflow_instance_id?: string
}

export interface GuardlineWebhookResponse {
  message?: string
  success: boolean
}

@Route('webhook')
export class WebhookController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger)
    private logger: ILogger,
  @inject(TYPES.IQueueHandler)
  private queueHandler: IQueueHandler,
  ) {
    super()
  }

  /**
   * Handle KYC webhook notifications from Guardline
   *
   * Receives asynchronous updates about KYC workflow status changes
   * and updates the corresponding PartnerUserKyc records in the database.
   */
  @Hidden() // Hide from public API docs as this is a webhook endpoint
  @Post('guardline')
  @Response('400', 'Bad Request - Invalid payload')
  @Response('404', 'Not Found - KYC session not found')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Webhook processed successfully')
  public async handleGuardlineWebhook(
    @Body() body: GuardlineWebhookRequest,
    @Request() request: RequestExpress,
    @Res() badRequest: TsoaResponse<400, { message: string, success: false }>,
    @Res() notFound: TsoaResponse<404, { message: string, success: false }>,
    @Res() serverError: TsoaResponse<500, { message: string, success: false }>,
  ): Promise<GuardlineWebhookResponse> {
    try {
      // Log the incoming webhook payload
      this.logger.info('Received Guardline webhook', {
        headers: request.headers,
        payload: body,
      })

      // Validate the webhook payload
      const validation = guardlineWebhookSchema.safeParse(body)
      if (!validation.success) {
        this.logger.error('Invalid Guardline webhook payload', {
          errors: validation.error.issues,
          payload: body,
        })
        return badRequest(400, {
          message: 'Invalid webhook payload format',
          success: false,
        })
      }

      const { workflow_instance_id } = validation.data
      const externalId = workflow_instance_id

      if (!externalId) {
        this.logger.error('Missing workflow_instance_id in Guardline webhook', { payload: body })
        return badRequest(400, {
          message: 'Missing instance_id or process_id',
          success: false,
        })
      }

      this.logger.info('Processing Guardline webhook', {
        externalId,
      })

      const prisma = await this.dbProvider.getClient()

      // Find the KYC record by external ID
      const kycRecord = await prisma.partnerUserKyc.findFirst({
        include: {
          partnerUser: {
            include: {
              partner: true,
            },
          },
        },
        where: { externalId },
      })

      if (!kycRecord) {
        this.logger.warn('KYC record not found for external ID', { externalId })
        return notFound(404, {
          message: 'KYC session not found',
          success: false,
        })
      }

      // Map Guardline status to internal KYC status
      // TODO: Implement a more comprehensive mapping if needed
      const kycStatus = KycStatus.APPROVED

      // Update the KYC record with the new status
      await prisma.partnerUserKyc.update({
        data: {
          status: kycStatus,
          updatedAt: new Date(),
        },
        where: { id: kycRecord.id },
      })

      this.logger.info('Updated KYC status from Guardline webhook', {
        externalId,
        kycRecordId: kycRecord.id,
        newStatus: kycStatus,
        oldStatus: kycRecord.status,
        partnerId: kycRecord.partnerUser.partner.id,
        partnerUserId: kycRecord.partnerUserId,
      })

      this.setStatus(200)
      return {
        message: 'Webhook processed successfully',
        success: true,
      }
    }
    catch (error) {
      this.logger.error('Error processing Guardline webhook', {
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
  ): Promise<GuardlineWebhookResponse> {
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

  /**
   * Maps Guardline webhook status to internal KYC status
   */
  private mapGuardlineStatusToKycStatus(guardlineStatus: string): KycStatus {
    switch (guardlineStatus) {
      case 'CANCELED':
      case 'COMPLETED_FAILURE':
        return KycStatus.REJECTED
      case 'COMPLETED_SUCCESS':
        return KycStatus.APPROVED
      case 'INCOMPLETE':
      default:
        return KycStatus.PENDING
    }
  }
}
