import { OutboxStatus, WebhookDeliveryPurpose } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'

export type PartnerAiWebhookDiagnostics = {
  configured: boolean
  deliveries: Array<{
    count: number
    status: OutboxStatus
  }>
  destinationHost: null | string
  latest: null | {
    attemptedAt: Date
    durationMs: null | number
    failureCode: 'DELIVERY_FAILED' | 'HTTP_REJECTED' | null
    httpStatus: null | number
    status: OutboxStatus
  }
  lookbackHours: number
}

const outboxStatuses = [
  OutboxStatus.PENDING,
  OutboxStatus.DELIVERING,
  OutboxStatus.DELIVERED,
  OutboxStatus.FAILED,
] as const

@injectable()
export class PartnerAiWebhookDiagnosticsService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async get(partnerId: string, lookbackHours: number): Promise<PartnerAiWebhookDiagnostics> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const createdFrom = new Date(Date.now() - lookbackHours * 60 * 60 * 1_000)
    const [partner, grouped, latest] = await Promise.all([
      prismaClient.partner.findUnique({
        select: { webhookUrl: true },
        where: { id: partnerId },
      }),
      prismaClient.outboxEvent.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: {
          partnerId,
          updatedAt: { gte: createdFrom },
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      }),
      prismaClient.outboxEvent.findFirst({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          lastAttemptDurationMs: true,
          lastHttpStatus: true,
          status: true,
          updatedAt: true,
        },
        where: {
          partnerId,
          updatedAt: { gte: createdFrom },
          webhookPurpose: WebhookDeliveryPurpose.TRANSACTION,
        },
      }),
    ])
    const countByStatus = new Map(grouped.map(row => [row.status, row._count._all]))
    return {
      configured: Boolean(partner?.webhookUrl),
      deliveries: outboxStatuses.map(status => ({
        count: countByStatus.get(status) ?? 0,
        status,
      })),
      destinationHost: this.toDestinationHost(partner?.webhookUrl ?? null),
      latest: latest
        ? {
            attemptedAt: latest.updatedAt,
            durationMs: latest.lastAttemptDurationMs,
            failureCode: latest.status === OutboxStatus.FAILED
              ? latest.lastHttpStatus === null ? 'DELIVERY_FAILED' : 'HTTP_REJECTED'
              : null,
            httpStatus: latest.lastHttpStatus,
            status: latest.status,
          }
        : null,
      lookbackHours,
    }
  }

  private toDestinationHost(webhookUrl: null | string): null | string {
    if (!webhookUrl) return null
    try {
      return new URL(webhookUrl).hostname || null
    }
    catch {
      return null
    }
  }
}
