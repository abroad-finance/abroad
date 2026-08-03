import { Prisma, PrismaClient, WebhookDeliveryPurpose } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../core/logging/scopedLogger'
import { ILogger } from '../../core/logging/types'
import { IQueueHandler, QueueName, QueuePayloadByName } from '../messaging/queues'
import { ISlackNotifier } from '../notifications/ISlackNotifier'
import { IWebhookNotifier, WebhookDeliveryError, WebhookEvent } from '../notifications/IWebhookNotifier'
import { OutboxDeliveryError } from './OutboxDeliveryHandler'
import { OutboxDeliveryHandlerRegistry } from './OutboxDeliveryHandlerRegistry'
import { OutboxCreateMetadata, OutboxDeliveryDiagnostics, OutboxRecord, OutboxRepository } from './OutboxRepository'

type OutboxPayload
  = | {
    kind: 'queue'
    payload: QueuePayloadByName[QueueName]
    queueName: QueueName
  }
  | { kind: 'slack', message: string }
  | {
    kind: 'webhook'
    payload: { data: Prisma.InputJsonValue, event: WebhookEvent }
    target: string
  }

type PrismaClientLike = Prisma.TransactionClient | PrismaClient

const DEFAULT_DELAY_MS = 5_000

type EnqueueOptions = {
  availableAt?: Date
  client?: PrismaClientLike
  deliverNow?: boolean
  metadata?: OutboxCreateMetadata
}

@injectable()
export class OutboxDispatcher {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(OutboxRepository) private readonly repository: OutboxRepository,
    @inject(TYPES.IWebhookNotifier) private readonly webhookNotifier: IWebhookNotifier,
    @inject(TYPES.ISlackNotifier) private readonly slackNotifier: ISlackNotifier,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(OutboxDeliveryHandlerRegistry)
    private readonly deliveryHandlerRegistry: OutboxDeliveryHandlerRegistry,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'OutboxDispatcher' })
  }

  public async deliver(record: OutboxRecord, context: string, client?: PrismaClientLike): Promise<void> {
    const payload = record.payload as OutboxPayload
    try {
      let diagnostics: OutboxDeliveryDiagnostics | undefined
      if (payload.kind === 'webhook') {
        const result = await this.webhookNotifier.notifyWebhook(
          payload.target,
          { data: this.toWebhookPayloadData(payload.payload.data), event: payload.payload.event },
          {
            credentialMode: record.webhookCredentialMode,
            partnerId: record.partnerId,
          },
        )
        diagnostics = { durationMs: result.durationMs, httpStatus: result.httpStatus }
      }
      else if (payload.kind === 'slack') {
        await this.slackNotifier.sendMessage(payload.message)
      }
      else if (payload.kind === 'queue') {
        await this.queueHandler.postMessage(payload.queueName, payload.payload)
      }
      else {
        await this.deliveryHandlerRegistry.deliver(record)
      }
      await this.repository.markDelivered(record.id, client, diagnostics)
    }
    catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      const diagnostics = error instanceof WebhookDeliveryError
        ? { durationMs: error.durationMs, httpStatus: error.httpStatus }
        : undefined
      const attempts = record.attempts + 1
      const backoffMs = Math.min(60_000, Math.max(DEFAULT_DELAY_MS, 2 ** attempts * 1000))
      const retryable = !(error instanceof OutboxDeliveryError) || error.retryable
      if (!retryable || attempts >= record.maxAttempts) {
        this.logger.error(`[Outbox] delivery failed permanently (${context})`, normalized)
        await this.repository.markFailed(record.id, normalized, client, diagnostics)
        if (record.webhookPurpose !== WebhookDeliveryPurpose.TEST) {
          await this.safePublishDeadLetter(normalized, record)
        }
        return
      }
      const nextAttempt = new Date(Date.now() + backoffMs)
      this.logger.warn(
        `[Outbox] delivery failed; scheduling retry in ${backoffMs}ms (${context})`,
        normalized,
      )
      await this.repository.reschedule(record.id, nextAttempt, normalized, client, diagnostics)
    }
  }

  public async enqueueCustom(
    kind: string,
    payload: Prisma.InputJsonObject,
    context: string,
    options: EnqueueOptions = {},
  ): Promise<OutboxRecord> {
    const normalizedKind = kind.trim()
    if (!normalizedKind || ['queue', 'slack', 'webhook'].includes(normalizedKind)) {
      throw new Error('Custom outbox delivery kind is invalid')
    }
    const deliverNow = options.deliverNow ?? !options.client
    const record = await this.repository.create(
      normalizedKind,
      this.normalizeJsonValue({ ...payload, kind: normalizedKind }),
      options.availableAt ?? new Date(),
      options.client,
      options.metadata,
    )
    if (deliverNow) {
      await this.deliver(record, context, options.client)
    }
    return record
  }

  public async enqueueQueue<Name extends QueueName>(
    queueName: Name,
    message: QueuePayloadByName[Name],
    context: string,
    options: EnqueueOptions = {},
  ): Promise<void> {
    const deliverNow = options.deliverNow ?? !options.client
    const payload: OutboxPayload = {
      kind: 'queue',
      payload: message,
      queueName,
    }
    const record = await this.repository.create(
      'queue',
      this.normalizePayload(payload),
      options.availableAt ?? new Date(),
      options.client,
      options.metadata,
    )
    if (deliverNow) {
      await this.deliver(record, context, options.client)
    }
  }

  public async enqueueSlack(
    message: string,
    context: string,
    options: EnqueueOptions = {},
  ): Promise<void> {
    if (!message.trim()) return
    const deliverNow = options.deliverNow ?? !options.client
    const payload: OutboxPayload = { kind: 'slack', message }
    const record = await this.repository.create(
      'slack',
      this.normalizePayload(payload),
      options.availableAt ?? new Date(),
      options.client,
      options.metadata,
    )
    if (deliverNow) {
      await this.deliver(record, context, options.client)
    }
  }

  public async enqueueWebhook(
    target: null | string,
    payload: { data: unknown, event: WebhookEvent },
    context: string,
    options: EnqueueOptions = {},
  ): Promise<null | OutboxRecord> {
    if (!target?.trim()) return null
    const deliverNow = options.deliverNow ?? !options.client
    const normalizedPayload: OutboxPayload = {
      kind: 'webhook',
      payload: {
        data: this.normalizeJsonValue(payload.data),
        event: payload.event,
      },
      target: target.trim(),
    }
    const record = await this.repository.create(
      'webhook',
      this.normalizePayload(normalizedPayload),
      options.availableAt ?? new Date(),
      options.client,
      {
        ...options.metadata,
        webhookEvent: options.metadata?.webhookEvent ?? payload.event,
      },
    )
    if (deliverNow) {
      await this.deliver(record, context, options.client)
    }
    return record
  }

  public async processPending(): Promise<void> {
    const pending = await this.repository.nextBatch()
    for (const record of pending) {
      await this.deliver(record, 'replay')
    }
  }

  private normalizeJsonValue(payload: unknown): Prisma.InputJsonValue {
    const replacer = (_key: string, value: unknown) => (value instanceof Date ? value.toISOString() : value)
    return JSON.parse(JSON.stringify(payload, replacer)) as Prisma.InputJsonValue
  }

  private normalizePayload(payload: OutboxPayload): Prisma.InputJsonValue {
    if (payload.kind === 'slack') {
      return payload
    }

    if (payload.kind === 'queue') {
      return {
        ...payload,
        payload: this.normalizeJsonValue(payload.payload),
      }
    }

    return {
      ...payload,
      payload: {
        ...payload.payload,
        data: this.normalizeJsonValue(payload.payload.data),
      },
    }
  }

  private async safePublishDeadLetter(error: Error, record: OutboxRecord): Promise<void> {
    try {
      await this.queueHandler.postMessage(QueueName.DEAD_LETTER, {
        error: error.message,
        originalQueue: 'outbox',
        payload: {
          id: record.id,
          payload: record.payload,
          type: record.type,
        },
        reason: 'delivery_failed',
      })
    }
    catch (dlqErr) {
      this.logger.warn('[Outbox] Failed to publish dead-letter for outbox delivery failure', dlqErr)
    }
  }

  private toWebhookPayloadData(data: Prisma.InputJsonValue): Record<string, unknown> {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>
    }
    return { value: data ?? null }
  }
}
