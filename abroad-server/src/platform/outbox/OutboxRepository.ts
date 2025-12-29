import { OutboxStatus, Prisma } from '@prisma/client'
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
  ): Promise<OutboxRecord> {
    const client = await this.dbProvider.getClient()
    const created = await client.outboxEvent.create({
      data: {
        availableAt,
        payload,
        type,
      },
    })
    return created
  }

  public async markDelivered(id: string): Promise<void> {
    const client = await this.dbProvider.getClient()
    await client.outboxEvent.update({
      data: {
        attempts: { increment: 1 },
        lastError: null,
        status: OutboxStatus.DELIVERED,
      },
      where: { id },
    })
  }

  public async markFailed(id: string, error: Error): Promise<void> {
    const client = await this.dbProvider.getClient()
    await client.outboxEvent.update({
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

  public async reschedule(
    id: string,
    nextAttempt: Date,
    error: Error,
  ): Promise<void> {
    const client = await this.dbProvider.getClient()
    await client.outboxEvent.update({
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
