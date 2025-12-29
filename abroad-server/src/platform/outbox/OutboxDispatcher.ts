import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../core/logging/scopedLogger'
import { ILogger } from '../../core/logging/types'
import { ISlackNotifier } from '../notifications/ISlackNotifier'
import { IWebhookNotifier, WebhookEvent } from '../notifications/IWebhookNotifier'
import { OutboxRecord, OutboxRepository } from './OutboxRepository'

type OutboxPayload = { kind: 'slack', message: string } | {
  kind: 'webhook'
  payload: { data: Prisma.JsonValue, event: WebhookEvent }
  target: string
}

const MAX_ATTEMPTS = 5

@injectable()
export class OutboxDispatcher {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(OutboxRepository) private readonly repository: OutboxRepository,
    @inject(TYPES.IWebhookNotifier) private readonly webhookNotifier: IWebhookNotifier,
    @inject(TYPES.ISlackNotifier) private readonly slackNotifier: ISlackNotifier,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'OutboxDispatcher' })
  }

  public async enqueueSlack(message: string, context: string): Promise<void> {
    if (!message.trim()) return
    const record = await this.repository.create('slack', { kind: 'slack', message })
    await this.deliver(record, context)
  }

  public async enqueueWebhook(
    target: null | string,
    payload: { data: Prisma.JsonValue, event: WebhookEvent },
    context: string,
  ): Promise<void> {
    if (!target?.trim()) return
    const record = await this.repository.create('webhook', { kind: 'webhook', payload, target: target.trim() })
    await this.deliver(record, context)
  }

  public async processPending(): Promise<void> {
    const pending = await this.repository.nextBatch()
    for (const record of pending) {
      await this.deliver(record, 'replay')
    }
  }

  private async deliver(record: OutboxRecord, context: string): Promise<void> {
    const payload = record.payload as OutboxPayload
    try {
      if (payload.kind === 'webhook') {
        await this.webhookNotifier.notifyWebhook(payload.target, payload.payload)
      }
      else if (payload.kind === 'slack') {
        await this.slackNotifier.sendMessage(payload.message)
      }
      await this.repository.markDelivered(record.id)
    }
    catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      const attempts = record.attempts + 1
      const backoffMs = Math.min(60_000, 2 ** attempts * 1000)
      if (attempts >= MAX_ATTEMPTS) {
        this.logger.error(`[Outbox] delivery failed permanently (${context})`, normalized)
        await this.repository.markFailed(record.id, normalized)
        return
      }
      const nextAttempt = new Date(Date.now() + backoffMs)
      this.logger.warn(
        `[Outbox] delivery failed; scheduling retry in ${backoffMs}ms (${context})`,
        normalized,
      )
      await this.repository.reschedule(record.id, nextAttempt, normalized)
    }
  }
}
