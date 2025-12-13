import { KycStatus, Prisma, PrismaClient } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { IQueueHandler, QueueName } from '../../../platform/messaging/queues'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
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
    this.logger.info('Received Persona webhook', { headers: request.headers, payload: body })

    const parsed = this.parseWebhookPayload(body)
    if (!parsed) {
      return buildWebhookResult('bad_request', WEBHOOK_INVALID_PAYLOAD)
    }

    try {
      const prisma = await this.dbProvider.getClient()
      const kycRecord = await this.findKycRecord(prisma, parsed.inquiryId)

      if (!kycRecord) {
        this.logger.warn('KYC record not found for Persona inquiry', {
          inquiryId: parsed.inquiryId,
        })
        return buildWebhookResult('not_found', 'KYC session not found')
      }

      const newStatus = this.mapPersonaToKycStatus(parsed.status)
      const statusHandled = await this.handleStatusChange(prisma, kycRecord, parsed.inquiryId, newStatus)
      if (!statusHandled) {
        return buildWebhookResult('ok', WEBHOOK_PROCESSED)
      }

      await this.publishUserNotification(kycRecord, parsed.inquiryId, newStatus)
      return buildWebhookResult('ok', WEBHOOK_PROCESSED)
    }
    catch (error) {
      this.logProcessingError(error, body)
      return buildWebhookResult('error', WEBHOOK_INTERNAL_ERROR)
    }
  }

  private async findKycRecord(prisma: PrismaClient, inquiryId: string): Promise<null | PartnerUserKycRecord> {
    return prisma.partnerUserKyc.findFirst({
      include: partnerUserInclude,
      where: {
        OR: [{ externalId: inquiryId }],
      },
    })
  }

  private async handleStatusChange(
    prisma: PrismaClient,
    kycRecord: PartnerUserKycRecord,
    inquiryId: string,
    newStatus: KycStatus,
  ): Promise<boolean> {
    if (newStatus === kycRecord.status) {
      this.logger.info('Persona webhook: status unchanged', {
        inquiryId,
        kycRecordId: kycRecord.id,
        status: newStatus,
      })
      return false
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

    return true
  }

  private logProcessingError(error: unknown, payload: Record<string, unknown>): void {
    this.logger.error('Error processing Persona webhook', {
      error: error instanceof Error ? error.message : 'Unknown error',
      payload,
      stack: error instanceof Error ? error.stack : undefined,
    })
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

  private parseWebhookPayload(body: Record<string, unknown>): null | { inquiryId: string, status?: PersonaStatus } {
    const parsed = personaWebhookSchema.safeParse(body)
    if (!parsed.success) {
      this.logger.error('Invalid Persona webhook payload', {
        errors: parsed.error.issues,
        payload: body,
      })
      return null
    }

    const payload: PersonaWebhookPayload = parsed.data
    const inquiryId = payload.data.attributes.payload.data.id
    const status = payload.data.attributes.payload.data.attributes.status

    return { inquiryId, status }
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
