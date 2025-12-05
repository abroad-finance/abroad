import { KycStatus } from '@prisma/client'
import { Request as RequestExpress } from 'express'

import { ILogger } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { GuardlineWebhookRequest, guardlineWebhookSchema } from './guardlineSchema'
import { WebhookProcessingResult } from './types'
import { WEBHOOK_INTERNAL_ERROR, WEBHOOK_INVALID_PAYLOAD, WEBHOOK_PROCESSED } from './webhookMessages'
import { buildWebhookResult } from './WebhookResponseBuilder'

export class GuardlineWebhookService {
  public constructor(
    private readonly dbProvider: IDatabaseClientProvider,
    private readonly logger: ILogger,
  ) { }

  public async processWebhook(
    body: GuardlineWebhookRequest,
    request: RequestExpress,
  ): Promise<WebhookProcessingResult> {
    this.logger.info('Received Guardline webhook', {
      headers: request.headers,
      payload: body,
    })

    const validation = guardlineWebhookSchema.safeParse(body)
    if (!validation.success) {
      this.logger.error('Invalid Guardline webhook payload', {
        errors: validation.error.issues,
        payload: body,
      })
      return buildWebhookResult('bad_request', WEBHOOK_INVALID_PAYLOAD)
    }

    const externalId = validation.data.workflow_instance_id
    if (!externalId) {
      this.logger.error('Missing workflow_instance_id in Guardline webhook', { payload: body })
      return buildWebhookResult('bad_request', 'Missing instance_id or process_id')
    }

    try {
      const prisma = await this.dbProvider.getClient()
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
        return buildWebhookResult('not_found', 'KYC session not found')
      }

      await prisma.partnerUserKyc.update({
        data: {
          status: KycStatus.APPROVED,
          updatedAt: new Date(),
        },
        where: { id: kycRecord.id },
      })

      this.logger.info('Updated KYC status from Guardline webhook', {
        externalId,
        kycRecordId: kycRecord.id,
        newStatus: KycStatus.APPROVED,
        oldStatus: kycRecord.status,
        partnerId: kycRecord.partnerUser.partner.id,
        partnerUserId: kycRecord.partnerUserId,
      })

      return buildWebhookResult('ok', WEBHOOK_PROCESSED)
    }
    catch (error) {
      this.logger.error('Error processing Guardline webhook', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload: body,
        stack: error instanceof Error ? error.stack : undefined,
      })
      return buildWebhookResult('error', WEBHOOK_INTERNAL_ERROR)
    }
  }
}
