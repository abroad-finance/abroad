import { OutboxStatus, Prisma } from '@prisma/client'

import { OutboxRecord, OutboxRepository } from '../../../platform/outbox/OutboxRepository'

type AsyncMock<T = unknown> = jest.Mock<Promise<T>, unknown[]>

type MockOutboxClient = {
  outboxEvent: {
    count: AsyncMock<number>
    create: AsyncMock<OutboxRecord>
    findMany: AsyncMock<OutboxRecord[]>
    update: AsyncMock
    updateMany: AsyncMock<{ count: number }>
  }
}

const buildMockClient = (): MockOutboxClient => {
  const baseRecord: OutboxRecord = {
    attempts: 0,
    availableAt: new Date(),
    createdAt: new Date(),
    id: 'outbox-1',
    lastError: null,
    payload: { payload: true },
    status: OutboxStatus.PENDING,
    type: 'queue',
    updatedAt: new Date(),
  }

  return {
    outboxEvent: {
      count: jest.fn<ReturnType<MockOutboxClient['outboxEvent']['count']>, unknown[]>(async () => 0),
      create: jest.fn<ReturnType<MockOutboxClient['outboxEvent']['create']>, unknown[]>(async (...args: unknown[]) => {
        const data = (args[0] as Prisma.OutboxEventCreateArgs | undefined)?.data ?? {}
        const availableAt = data && 'availableAt' in data && data.availableAt instanceof Date
          ? data.availableAt
          : baseRecord.availableAt
        return {
          ...baseRecord,
          ...data,
          availableAt,
        }
      }),
      findMany: jest.fn<ReturnType<MockOutboxClient['outboxEvent']['findMany']>, unknown[]>(async () => [baseRecord]),
      update: jest.fn<ReturnType<MockOutboxClient['outboxEvent']['update']>, unknown[]>(async () => ({})),
      updateMany: jest.fn<ReturnType<MockOutboxClient['outboxEvent']['updateMany']>, unknown[]>(async () => ({ count: 1 })),
    },
  }
}

describe('OutboxRepository', () => {
  it('creates, delivers, and reschedules records using provided clients', async () => {
    const externalClient = buildMockClient()
    const provider = { getClient: jest.fn(async () => buildMockClient()) }
    const repository = new OutboxRepository(provider as never)
    const availableAt = new Date('2024-01-01T00:00:00.000Z')
    const payload: Prisma.InputJsonValue = { example: true }

    const created = await repository.create('queue', payload, availableAt, externalClient as never)
    expect(provider.getClient).not.toHaveBeenCalled()
    expect(externalClient.outboxEvent.create).toHaveBeenCalledWith({
      data: { availableAt, payload, type: 'queue' },
    })
    expect(created.payload).toEqual(payload)
    expect(created.availableAt).toEqual(availableAt)

    await repository.markDelivered(created.id, externalClient as never)
    expect(externalClient.outboxEvent.update).toHaveBeenCalledWith({
      data: { attempts: { increment: 1 }, lastError: null, status: OutboxStatus.DELIVERED },
      where: { id: created.id },
    })

    const failure = new Error('network')
    await repository.markFailed(created.id, failure, externalClient as never)
    expect(externalClient.outboxEvent.update).toHaveBeenCalledWith({
      data: { attempts: { increment: 1 }, lastError: 'network', status: OutboxStatus.FAILED },
      where: { id: created.id },
    })

    const nextAttempt = new Date('2024-01-02T00:00:00.000Z')
    await repository.reschedule(created.id, nextAttempt, failure, externalClient as never)
    expect(externalClient.outboxEvent.update).toHaveBeenCalledWith({
      data: {
        attempts: { increment: 1 },
        availableAt: nextAttempt,
        lastError: 'network',
        status: OutboxStatus.PENDING,
      },
      where: { id: created.id },
    })
  })

  it('uses provider client for queries and aggregates failure counts', async () => {
    const client = buildMockClient()
    client.outboxEvent.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    const provider = { getClient: jest.fn(async () => client) }
    const repository = new OutboxRepository(provider as never)

    await repository.markDelivered('abc')
    expect(client.outboxEvent.update).toHaveBeenCalledWith({
      data: { attempts: { increment: 1 }, lastError: null, status: OutboxStatus.DELIVERED },
      where: { id: 'abc' },
    })

    const batch = await repository.nextBatch(10, new Date('2024-02-01T00:00:00.000Z'))
    expect(provider.getClient).toHaveBeenCalled()
    expect(client.outboxEvent.findMany).toHaveBeenCalledWith({
      orderBy: { availableAt: 'asc' },
      take: 10,
      where: { availableAt: { lte: new Date('2024-02-01T00:00:00.000Z') }, status: OutboxStatus.PENDING },
    })
    expect(batch).toHaveLength(1)

    const summary = await repository.summarizeFailures()
    expect(summary).toEqual({ delivering: 1, failed: 3, pending: 2 })
  })
})
