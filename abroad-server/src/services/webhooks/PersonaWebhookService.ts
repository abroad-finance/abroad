import { KycStatus, Prisma } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject, injectable } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { TYPES } from '../../types'
import { PersonaStatus, PersonaWebhookPayload, personaWebhookSchema } from './personaSchema'
import { WebhookProcessingResult } from './types'
import { WEBHOOK_INTERNAL_ERROR, WEBHOOK_INVALID_PAYLOAD, WEBHOOK_PROCESSED } from './webhookMessages'
import { buildWebhookResult } from './WebhookResponseBuilder'

const partnerUserInclude = {
  partnerUser: {
    include: { partner: true },
  },
} as const
type PartnerUserKycRecord = Prisma.PartnerUserKycGetPayload<{ include: typeof partnerUserInclude }>

@injectable()
export class PersonaWebhookService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
  ) { }

  public async processWebhook(
    body: Record<string, unknown>,
    request: RequestExpress & { rawBody?: string },
  ): Promise<WebhookProcessingResult> {
    this.logger.info('Received Persona webhook', {
      headers: request.headers,
      payload: body,
    })

    const parsed = personaWebhookSchema.safeParse(body)
    if (!parsed.success) {
      this.logger.error('Invalid Persona webhook payload', {
        errors: parsed.error.issues,
        payload: body,
      })
      return buildWebhookResult('bad_request', WEBHOOK_INVALID_PAYLOAD)
    }

    const payload: PersonaWebhookPayload = parsed.data
    const inquiryId = payload.data.attributes.payload.data.id
    const status = payload.data.attributes.payload.data.attributes.status

    try {
      const prisma = await this.dbProvider.getClient()
      const kycRecord = await prisma.partnerUserKyc.findFirst({
        include: partnerUserInclude,
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
        return buildWebhookResult('not_found', 'KYC session not found')
      }

      const newStatus = this.mapPersonaToKycStatus(status)
      if (newStatus === kycRecord.status) {
        this.logger.info('Persona webhook: status unchanged', {
          inquiryId,
          kycRecordId: kycRecord.id,
          status: newStatus,
        })
        return buildWebhookResult('ok', WEBHOOK_PROCESSED)
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

      await this.publishUserNotification(kycRecord, inquiryId, newStatus)

      return buildWebhookResult('ok', WEBHOOK_PROCESSED)
    }
    catch (error) {
      this.logger.error('Error processing Persona webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: body,
        stack: error instanceof Error ? error.stack : undefined,
      })
      return buildWebhookResult('error', WEBHOOK_INTERNAL_ERROR)
    }
  }

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
        return KycStatus.PENDING
    }
  }

  private async publishUserNotification(kycRecord: PartnerUserKycRecord, inquiryId: string, newStatus: KycStatus): Promise<void> {
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
    catch (error) {
      const warningContext = error instanceof Error ? error : new Error(String(error))
      this.logger.warn('Failed to publish kyc.updated notification (persona)', warningContext)
    }
  }
}
