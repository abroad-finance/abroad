import {
  OutboxEvent,
  OutboxStatus,
  Prisma,
  PrismaClient,
  WebhookCredentialMode,
  WebhookDeliveryPurpose,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../app/container/types'
import { IDatabaseClientProvider } from '../persistence/IDatabaseClientProvider'

export type OutboxCreateMetadata = {
  idempotencyKey?: string
  initiatedByPortalUserId?: string
  maxAttempts?: number
  partnerId?: string
  sourceOutboxEventId?: string
  transactionId?: string
  webhookCredentialMode?: WebhookCredentialMode
  webhookEvent?: string
  webhookPurpose?: WebhookDeliveryPurpose
}

export type OutboxDeliveryDiagnostics = {
  durationMs: number
  httpStatus: null | number
}

export type OutboxRecord = OutboxEvent

type PrismaClientLike = Prisma.TransactionClient | PrismaClient

@injectable()
export class OutboxRepository {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async create(
    type: string,
    payload: Prisma.InputJsonValue,
    availableAt: Date = new Date(),
    client?: PrismaClientLike,
    metadata: OutboxCreateMetadata = {},
  ): Promise<OutboxRecord> {
    const prisma = client ?? await this.dbProvider.getClient()
    const created = await prisma.outboxEvent.create({
      data: {
        availableAt,
        idempotencyKey: metadata.idempotencyKey,
        initiatedByPortalUserId: metadata.initiatedByPortalUserId,
        maxAttempts: metadata.maxAttempts,
        partnerId: metadata.partnerId,
        payload,
        sourceOutboxEventId: metadata.sourceOutboxEventId,
        transactionId: metadata.transactionId,
        type,
        webhookCredentialMode: metadata.webhookCredentialMode,
        webhookEvent: metadata.webhookEvent,
        webhookPurpose: metadata.webhookPurpose,
      },
    })
    return created
  }

  public async markDelivered(
    id: string,
    client?: PrismaClientLike,
    diagnostics?: OutboxDeliveryDiagnostics,
  ): Promise<void> {
    const prisma = client ?? await this.dbProvider.getClient()
    await prisma.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        lastAttemptDurationMs: diagnostics?.durationMs,
        lastError: null,
        lastHttpStatus: diagnostics?.httpStatus,
        status: OutboxStatus.DELIVERED,
      },
      where: { id },
    })
  }

  public async markFailed(
    id: string,
    error: Error,
    client?: PrismaClientLike,
    diagnostics?: OutboxDeliveryDiagnostics,
  ): Promise<void> {
    const prisma = client ?? await this.dbProvider.getClient()
    await prisma.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        lastAttemptDurationMs: diagnostics?.durationMs,
        lastError: error.message,
        lastHttpStatus: diagnostics?.httpStatus,
        status: OutboxStatus.FAILED,
      },
      where: { id },
    })
  }

  public async nextBatch(
    limit = 25,
    now = new Date(),
  ): Promise<OutboxRecord[]> {
    const client = await this.dbProvider.getClient()
    return client.outboxEvent.findMany({
      orderBy: { availableAt: 'asc' },
      take: limit,
      where: { availableAt: { lte: now }, status: OutboxStatus.PENDING },
    })
  }

  public async reschedule(
    id: string,
    nextAttempt: Date,
    error: Error,
    client?: PrismaClientLike,
    diagnostics?: OutboxDeliveryDiagnostics,
  ): Promise<void> {
    const prisma = client ?? await this.dbProvider.getClient()
    await prisma.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        availableAt: nextAttempt,
        lastAttemptDurationMs: diagnostics?.durationMs,
        lastError: error.message,
        lastHttpStatus: diagnostics?.httpStatus,
        status: OutboxStatus.PENDING,
      },
      where: { id },
    })
  }

  public async summarizeFailures(): Promise<{ delivering: number, failed: number, pending: number }> {
    const client = await this.dbProvider.getClient()
    const [failed, delivering, pending] = await Promise.all([
      client.outboxEvent.count({ where: { status: OutboxStatus.FAILED } }),
      client.outboxEvent.count({ where: { status: OutboxStatus.DELIVERING } }),
      client.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
    ])
    return { delivering, failed, pending }
  }
}
