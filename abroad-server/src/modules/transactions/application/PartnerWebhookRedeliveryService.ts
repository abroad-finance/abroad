import { OutboxStatus, Prisma, WebhookCredentialMode, WebhookDeliveryPurpose } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { PartnerPortalAuditService } from '../../partners/application/PartnerPortalAuditService'
import { PartnerPortalPrincipal } from '../../partners/application/PartnerPortalSessionService'

const MAX_REDELIVERIES_PER_SOURCE = 3
const REDELIVERY_COOLDOWN_MS = 60 * 1_000
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/

export type PartnerWebhookRedeliveryResult = {
  alreadyExisted: boolean
  attempts: number
  deliveryId: string
  durationMs: null | number
  httpStatus: null | number
  status: OutboxStatus
}

type ParsedWebhookPayload = {
  data: Record<string, unknown>
  event: WebhookEvent.TRANSACTION_CREATED | WebhookEvent.TRANSACTION_UPDATED
}

export class PartnerWebhookRedeliveryNotFoundError extends Error {
  public constructor() {
    super('Webhook delivery not found')
    this.name = 'PartnerWebhookRedeliveryNotFoundError'
  }
}

export class PartnerWebhookRedeliveryValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PartnerWebhookRedeliveryValidationError'
  }
}

@injectable()
export class PartnerWebhookRedeliveryService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IOutboxDispatcher)
    private readonly outboxDispatcher: OutboxDispatcher,
    @inject(PartnerPortalAuditService)
    private readonly auditService: PartnerPortalAuditService,
  ) {}

  public async redeliver(
    principal: PartnerPortalPrincipal,
    transactionId: string,
    sourceDeliveryId: string,
    idempotencyKey: string,
  ): Promise<PartnerWebhookRedeliveryResult> {
    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(
      principal.partner.id,
      idempotencyKey,
    )
    const prismaClient = await this.databaseClientProvider.getClient()
    const created = await prismaClient.$transaction(async (transaction) => {
      const existing = await transaction.outboxEvent.findUnique({
        where: { idempotencyKey: normalizedIdempotencyKey },
      })
      if (existing) {
        if (
          existing.partnerId !== principal.partner.id
          || existing.transactionId !== transactionId
          || existing.sourceOutboxEventId !== sourceDeliveryId
        ) {
          throw new PartnerWebhookRedeliveryValidationError('Idempotency key is already in use')
        }
        return { alreadyExisted: true, record: existing }
      }

      const source = await transaction.outboxEvent.findFirst({
        include: {
          _count: { select: { redeliveries: true } },
          redeliveries: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { createdAt: true },
            take: 1,
          },
        },
        where: {
          id: sourceDeliveryId,
          partnerId: principal.partner.id,
          transactionId,
          type: 'webhook',
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      })
      if (!source) {
        throw new PartnerWebhookRedeliveryNotFoundError()
      }
      if (source.status !== OutboxStatus.FAILED) {
        throw new PartnerWebhookRedeliveryValidationError(
          'Only a failed original webhook delivery can be redelivered',
        )
      }
      if (source._count.redeliveries >= MAX_REDELIVERIES_PER_SOURCE) {
        throw new PartnerWebhookRedeliveryValidationError(
          'This webhook delivery has reached its redelivery limit',
        )
      }
      const latestRedelivery = source.redeliveries[0]
      if (
        latestRedelivery
        && Date.now() - latestRedelivery.createdAt.getTime() < REDELIVERY_COOLDOWN_MS
      ) {
        throw new PartnerWebhookRedeliveryValidationError(
          'Wait one minute before redelivering this webhook again',
        )
      }

      const payload = this.parseWebhookPayload(source.payload)
      const partner = await transaction.partner.findUnique({
        select: {
          webhookConfiguration: { select: { activeSecretCiphertext: true } },
          webhookUrl: true,
        },
        where: { id: principal.partner.id },
      })
      if (!partner?.webhookUrl) {
        throw new PartnerWebhookRedeliveryValidationError(
          'An active webhook URL is required for redelivery',
        )
      }
      const record = await this.outboxDispatcher.enqueueWebhook(
        partner.webhookUrl,
        payload,
        'partner-portal:webhook-redelivery',
        {
          client: transaction,
          deliverNow: false,
          metadata: {
            idempotencyKey: normalizedIdempotencyKey,
            initiatedByPortalUserId: principal.userId,
            maxAttempts: 5,
            partnerId: principal.partner.id,
            sourceOutboxEventId: source.id,
            transactionId,
            webhookCredentialMode: partner.webhookConfiguration?.activeSecretCiphertext
              ? WebhookCredentialMode.PARTNER_CURRENT
              : WebhookCredentialMode.LEGACY_ORIGIN,
            webhookPurpose: WebhookDeliveryPurpose.REDELIVERY,
          },
        },
      )
      if (!record) {
        throw new PartnerWebhookRedeliveryValidationError('Webhook redelivery could not be created')
      }
      await this.auditService.record({
        action: 'webhook.redelivery_requested',
        actorUserId: principal.userId,
        partnerId: principal.partner.id,
        resourceId: record.id,
        resourceType: 'webhook_delivery',
      }, transaction)
      return { alreadyExisted: false, record }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    if (!created.alreadyExisted && created.record.status === OutboxStatus.PENDING) {
      await this.outboxDispatcher.deliver(
        created.record,
        'partner-portal:webhook-redelivery',
      )
    }
    const result = await prismaClient.outboxEvent.findUnique({
      where: { id: created.record.id },
    })
    if (!result) {
      throw new PartnerWebhookRedeliveryNotFoundError()
    }
    return {
      alreadyExisted: created.alreadyExisted,
      attempts: result.attempts,
      deliveryId: result.id,
      durationMs: result.lastAttemptDurationMs,
      httpStatus: result.lastHttpStatus,
      status: result.status,
    }
  }

  private isJsonObject(value: Prisma.JsonValue | undefined): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private normalizeIdempotencyKey(partnerId: string, idempotencyKey: string): string {
    const normalized = idempotencyKey.trim()
    if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
      throw new PartnerWebhookRedeliveryValidationError(
        'Idempotency-Key must contain 8-128 letters, numbers, dots, underscores, colons, or hyphens',
      )
    }
    return `partner-redelivery:${partnerId}:${normalized}`
  }

  private parseWebhookPayload(payload: Prisma.JsonValue): ParsedWebhookPayload {
    if (!this.isJsonObject(payload) || payload.kind !== 'webhook') {
      throw new PartnerWebhookRedeliveryValidationError('Webhook payload is unavailable')
    }
    const nested = payload.payload
    if (!this.isJsonObject(nested) || !this.isJsonObject(nested.data)) {
      throw new PartnerWebhookRedeliveryValidationError('Webhook payload is unavailable')
    }
    if (
      nested.event !== WebhookEvent.TRANSACTION_CREATED
      && nested.event !== WebhookEvent.TRANSACTION_UPDATED
    ) {
      throw new PartnerWebhookRedeliveryValidationError('Webhook event cannot be redelivered')
    }
    return { data: nested.data, event: nested.event }
  }
}
