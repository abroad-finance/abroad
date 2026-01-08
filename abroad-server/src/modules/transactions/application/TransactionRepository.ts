import { Prisma, PrismaClient, TransactionStatus } from '@prisma/client'

import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { transactionNotificationInclude, TransactionWithRelations } from './transactionNotificationTypes'
import { InvalidTransactionTransitionError, resolveTransition, TransactionTransitionName } from './TransactionStateMachine'

type TransactionClient = Awaited<ReturnType<IDatabaseClientProvider['getClient']>> | Prisma.TransactionClient

export class TransactionRepository {
  public constructor(private readonly dbProvider: IDatabaseClientProvider) {}

  public async applyTransition(
    prismaClient: TransactionClient,
    params: {
      context?: Prisma.InputJsonValue
      data?: Prisma.TransactionUpdateInput
      idempotencyKey: string
      name: TransactionTransitionName
      transactionId: string
    },
  ): Promise<TransactionWithRelations | null> {
    return this.withTransaction(prismaClient, async (tx) => {
      const existing = await tx.transactionTransition.findUnique({
        where: {
          transactionId_idempotencyKey: {
            idempotencyKey: params.idempotencyKey,
            transactionId: params.transactionId,
          },
        },
      })
      if (existing) {
        return this.loadTransaction(tx, params.transactionId)
      }

      const current = await tx.transaction.findUnique({
        include: transactionNotificationInclude,
        where: { id: params.transactionId },
      })
      if (!current) return null

      let toStatus: TransactionStatus
      try {
        toStatus = resolveTransition(current.status, params.name)
      }
      catch (error) {
        if (error instanceof InvalidTransactionTransitionError) {
          return null
        }
        throw error
      }

      const updated = await tx.transaction.update({
        data: {
          ...params.data,
          status: toStatus,
        },
        include: transactionNotificationInclude,
        where: { id: params.transactionId },
      })

      await tx.transactionTransition.create({
        data: {
          context: params.context,
          event: params.name,
          fromStatus: current.status,
          idempotencyKey: params.idempotencyKey,
          toStatus,
          transactionId: params.transactionId,
        },
      })

      return updated
    })
  }

  public async applyDepositReceived(
    prismaClient: TransactionClient,
    params: {
      idempotencyKey: string
      onChainId: string
      transactionId: string
    },
  ): Promise<TransactionWithRelations | undefined> {
    const updated = await this.applyTransition(prismaClient, {
      data: {
        onChainId: params.onChainId,
      },
      idempotencyKey: params.idempotencyKey,
      name: 'deposit_received',
      transactionId: params.transactionId,
    })

    return updated ?? undefined
  }

  public async applyExpiration(
    prismaClient: TransactionClient,
    params: { idempotencyKey: string, transactionId: string },
  ): Promise<TransactionWithRelations | null> {
    return this.applyTransition(prismaClient, {
      idempotencyKey: params.idempotencyKey,
      name: 'expired',
      transactionId: params.transactionId,
    })
  }

  public async markExchangeHandoff(
    prismaClient: TransactionClient,
    transactionId: string,
  ): Promise<void> {
    await prismaClient.transaction.updateMany({
      data: { exchangeHandoffAt: new Date() },
      where: { exchangeHandoffAt: null, id: transactionId },
    })
  }

  public async findByExternalId(externalId: string): Promise<null | TransactionWithRelations> {
    const client = await this.dbProvider.getClient()
    return client.transaction.findUnique({
      include: transactionNotificationInclude,
      where: { externalId },
    })
  }

  public async findRefundState(transactionId: string): Promise<null | {
    id: string
    onChainId: null | string
    refundOnChainId: null | string
    status: TransactionStatus
  }> {
    const client = await this.dbProvider.getClient()
    return client.transaction.findUnique({
      select: {
        id: true,
        onChainId: true,
        refundOnChainId: true,
        status: true,
      },
      where: { id: transactionId },
    })
  }

  public async getClient(): Promise<Awaited<ReturnType<IDatabaseClientProvider['getClient']>>> {
    return this.dbProvider.getClient()
  }

  public async persistExternalId(
    prismaClient: TransactionClient,
    transactionId: string,
    externalId: string,
  ): Promise<void> {
    await prismaClient.transaction.update({
      data: { externalId },
      where: { id: transactionId },
    })
  }

  public async recordOnChainIdIfMissing(
    prismaClient: TransactionClient,
    transactionId: string,
    onChainId: string,
  ): Promise<boolean> {
    const result = await prismaClient.transaction.updateMany({
      data: { onChainId },
      where: { id: transactionId, onChainId: null },
    })
    return result.count > 0
  }

  public async recordRefundOnChainId(
    prismaClient: TransactionClient,
    transactionId: string,
    refundTransactionId: string,
  ): Promise<void> {
    await prismaClient.transaction.updateMany({
      data: { refundOnChainId: refundTransactionId },
      where: { id: transactionId, refundOnChainId: null },
    })
  }

  public async updateStatus(
    prismaClient: TransactionClient,
    transactionId: string,
    status: TransactionStatus,
  ): Promise<TransactionWithRelations> {
    return prismaClient.transaction.update({
      data: { status },
      include: transactionNotificationInclude,
      where: { id: transactionId },
    })
  }

  private async withTransaction<T>(
    client: TransactionClient,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maybeClient = client as Prisma.TransactionClient & { $transaction?: PrismaClient['$transaction'] }
    if (typeof maybeClient.$transaction === 'function') {
      return maybeClient.$transaction(fn)
    }
    return fn(maybeClient)
  }

  private async loadTransaction(
    prismaClient: TransactionClient,
    transactionId: string,
  ): Promise<TransactionWithRelations | null> {
    return prismaClient.transaction.findUnique({
      include: transactionNotificationInclude,
      where: { id: transactionId },
    })
  }
}
