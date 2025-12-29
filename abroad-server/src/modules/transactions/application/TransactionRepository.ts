import { Prisma, TransactionStatus } from '@prisma/client'

import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { transactionNotificationInclude, TransactionWithRelations } from './transactionNotificationTypes'

type TransactionClient = Awaited<ReturnType<IDatabaseClientProvider['getClient']>> | Prisma.TransactionClient

export class TransactionRepository {
  public constructor(private readonly dbProvider: IDatabaseClientProvider) {}

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

  public async markExchangeHandoff(
    prismaClient: TransactionClient,
    transactionId: string,
  ): Promise<void> {
    await prismaClient.transaction.updateMany({
      data: { exchangeHandoffAt: new Date() },
      where: { exchangeHandoffAt: null, id: transactionId },
    })
  }

  public async markProcessingAwaiting(
    transactionId: string,
    onChainId: string,
  ): Promise<TransactionWithRelations | undefined> {
    const client = await this.dbProvider.getClient()
    try {
      return await client.transaction.update({
        data: {
          onChainId,
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
        include: transactionNotificationInclude,
        where: {
          id: transactionId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return undefined
      }
      throw error
    }
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
}
