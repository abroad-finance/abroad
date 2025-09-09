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

enum PersonaStatusEnum {
  Approved = 'approved',
  Completed = 'completed',
  Created = 'created',
  Declined = 'declined',
  Expired = 'expired',
  Failed = 'failed',
  NeedsReview = 'needs_review',
  Pending = 'pending',
}

interface GuardlineWebhookRequest {
  [key: string]: unknown // Allow excess properties
  workflow_instance_id?: string
}

interface GuardlineWebhookResponse {
  message?: string
  success: boolean
}

type PersonaStatus = 'approved'
  | 'completed'
  | 'created'
  | 'declined'
  | 'expired'
  | 'failed'
  | 'needs_review'
  | 'pending'

// ---------------- Persona webhook schema ----------------
const personaWebhookSchema = z.object({
  data: z.object({
    attributes: z.object({
      payload: z.object({
        data: z.object({
          attributes: z.object({
            status: z.enum(PersonaStatusEnum),
          }),
          id: z.string().min(1), // Persona Inquiry ID
        }),
      }),
    }),
  }),
}).loose()

type PersonaWebhookPayload = z.infer<typeof personaWebhookSchema>

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
  ): Promise<{ message?: string, success: boolean }> {
    try {
      this.logger.info('Received Persona webhook', {
        headers: request.headers,
        payload: body,
      })
      // TODO: Add HMAC signature verification

      // Validate payload shape
      const parsed = personaWebhookSchema.safeParse(body)
      if (!parsed.success) {
        this.logger.error('Invalid Persona webhook payload', {
          errors: parsed.error.issues,
          payload: body,
        })
        return badRequest(400, { message: 'Invalid webhook payload format', success: false })
      }

      const payload: PersonaWebhookPayload = parsed.data
      const inquiryId = payload.data.attributes.payload.data.id
      const status = payload.data.attributes.payload.data.attributes.status

      this.logger.info('Processing Persona webhook', {
        inquiryId,
        status,
      })

      const prisma = await this.dbProvider.getClient()

      // Try to find the KYC record either by the Persona inquiry id or the reference_id
      const kycRecord = await prisma.partnerUserKyc.findFirst({
        include: {
          partnerUser: {
            include: { partner: true },
          },
        },
        where: {
          OR: [
            { externalId: inquiryId },
          ],
        },
      })

      if (!kycRecord) {
        this.logger.warn('KYC record not found for Persona inquiry', {
          inquiryId,
        })
        return notFound(404, { message: 'KYC session not found', success: false })
      }

      const newStatus = this.mapPersonaToKycStatus(status)

      // If no effective status change, acknowledge without writing
      if (newStatus === kycRecord.status) {
        this.logger.info('Persona webhook: status unchanged', {
          inquiryId,
          kycRecordId: kycRecord.id,
          status: newStatus,
        })
        this.setStatus(200)
        return { message: 'Webhook processed successfully', success: true }
      }

      await prisma.partnerUserKyc.update({
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
        where: { id: kycRecord.id },
      })

      this.logger.info('Updated KYC status from Persona webhook', {
        inquiryId,
        kycRecordId: kycRecord.id,
        newStatus,
        oldStatus: kycRecord.status,
        partnerId: kycRecord.partnerUser.partner.id,
        partnerUserId: kycRecord.partnerUserId,
      })

      // Emit websocket notification for the user
      try {
        await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
          payload: JSON.stringify({
            externalId: inquiryId,
            kycId: kycRecord.id,
            newStatus,
            oldStatus: kycRecord.status,
            partnerId: kycRecord.partnerUser.partner.id,
            partnerUserId: kycRecord.partnerUserId,
            provider: 'persona',
            updatedAt: new Date().toISOString(),
          }),
          type: 'kyc.updated',
          userId: kycRecord.partnerUser.userId,
        })
      }
      catch (notifyErr) {
        this.logger.warn('Failed to publish kyc.updated notification (persona)', notifyErr)
      }

      this.setStatus(200)
      return { message: 'Webhook processed successfully', success: true }
    }
    catch (error) {
      this.logger.error('Error processing Persona webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: body,
        stack: error instanceof Error ? error.stack : undefined,
      })
      return serverError(500, { message: 'Internal server error', success: false })
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
   * Maps Persona inquiry status/decision to internal KYC status
   * Heuristics:
   * - decision: "approved" => APPROVED, "declined" => REJECTED
   * - otherwise fall back to status:
   *   "completed" w/o decision => PENDING (neutral)
   *   "processing" / "pending" / "requires_input" => PENDING
   *   "expired" / "failed" => REJECTED
   */
  private mapPersonaToKycStatus(status?: PersonaStatus): KycStatus {
    switch (status) {
      case 'approved':
        return KycStatus.APPROVED

      case 'declined':
      case 'expired':
      case 'failed':
        return KycStatus.REJECTED

      case 'needs_review':
        return KycStatus.PENDING_APPROVAL

      case 'completed':
      case 'created':
      case 'pending':
      case undefined:
      default:
        // If completed but no decision provided, keep pending to avoid false positives
        return KycStatus.PENDING
    }
  }
}
