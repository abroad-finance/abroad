import { OutboxStatus, Prisma, PrismaClient } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../app/container/types'
import { IDatabaseClientProvider } from '../persistence/IDatabaseClientProvider'

export type OutboxRecord = {
  attempts: number
  availableAt: Date
  createdAt: Date
  id: string
  lastError: null | string
  payload: Prisma.JsonValue
  status: OutboxStatus
  type: string
  updatedAt: Date
}

@injectable()
export class OutboxRepository {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async create(
    type: string,
    payload: Prisma.JsonValue,
    availableAt: Date = new Date(),
    client?: PrismaClient,
  ): Promise<OutboxRecord> {
    const prisma = client ?? await this.dbProvider.getClient()
    const created = await prisma.outboxEvent.create({
      data: {
        availableAt,
        payload,
        type,
      },
    })
    return created
  }

  public async markDelivered(id: string, client?: PrismaClient): Promise<void> {
    const prisma = client ?? await this.dbProvider.getClient()
    await prisma.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        lastError: null,
        status: OutboxStatus.DELIVERED,
      },
      where: { id },
    })
  }

  public async markFailed(id: string, error: Error, client?: PrismaClient): Promise<void> {
    const prisma = client ?? await this.dbProvider.getClient()
    await prisma.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        lastError: error.message,
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

  public async summarizeFailures(): Promise<{ delivering: number, failed: number, pending: number }> {
    const client = await this.dbProvider.getClient()
    const [failed, delivering, pending] = await Promise.all([
      client.outboxEvent.count({ where: { status: OutboxStatus.FAILED } }),
      client.outboxEvent.count({ where: { status: OutboxStatus.DELIVERING } }),
      client.outboxEvent.count({ where: { status: OutboxStatus.PENDING } }),
    ])
    return { delivering, failed, pending }
  }

  public async reschedule(
    id: string,
    nextAttempt: Date,
    error: Error,
    client?: PrismaClient,
  ): Promise<void> {
    const prisma = client ?? await this.dbProvider.getClient()
    await prisma.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        availableAt: nextAttempt,
        lastError: error.message,
        status: OutboxStatus.PENDING,
      },
      where: { id },
    })
  }
}
