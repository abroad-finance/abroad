import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TransactionStatus } from '.prisma/client'

import { PublicTransactionsController } from '../../../../../modules/transactions/interfaces/http/PublicTransactionsController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../../platform/secrets/ISecretManager'
import { createMockLogger, type MockLogger } from '../../../../setup/mockFactories'

type PrismaTestClient = {
  $transaction: jest.Mock<Promise<unknown>, [(tx: PrismaTestClient) => Promise<unknown>]>
  transaction: PrismaTransactionDelegate
  transactionTransition: PrismaTransitionDelegate
}

type PrismaTransactionDelegate = {
  count: jest.Mock<Promise<number>, [unknown?]>
  findMany: jest.Mock<Promise<TransactionFixture[]>, [unknown?]>
  findUnique: jest.Mock<Promise<null | TransactionFixture>, [TransactionFindArgs]>
  update: jest.Mock<Promise<null | TransactionFixture>, [TransactionFindArgs]>
  updateMany: jest.Mock<Promise<{ count: number }>, [unknown?]>
}

type PrismaTransitionDelegate = {
  create: jest.Mock<Promise<unknown>, [unknown?]>
  findUnique: jest.Mock<Promise<unknown>, [unknown?]>
}

type TransactionFindArgs = { where: { id: string } }

type TransactionFixture = {
  id: string
  partnerUser: { partner: { id: string, name: string, webhookUrl: string }, userId: string }
  quote: {
    cryptoCurrency: CryptoCurrency
    expirationDate: Date
    network: BlockchainNetwork
    paymentMethod: PaymentMethod
    sourceAmount: number
    targetAmount: number
    targetCurrency: string
  }
  status: TransactionStatus
}

const buildPrismaClient = (): PrismaTestClient => {
  const prismaClient: PrismaTestClient = {
    $transaction: jest.fn<Promise<unknown>, [(tx: PrismaTestClient) => Promise<unknown>]>(),
    transaction: {
      count: jest.fn<Promise<number>, [unknown?]>(),
      findMany: jest.fn<Promise<TransactionFixture[]>, [unknown?]>(),
      findUnique: jest.fn<Promise<null | TransactionFixture>, [TransactionFindArgs]>(),
      update: jest.fn<Promise<null | TransactionFixture>, [TransactionFindArgs]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [unknown?]>(),
    },
    transactionTransition: {
      create: jest.fn<Promise<unknown>, [unknown?]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown?]>().mockResolvedValue(null),
    },
  }
  prismaClient.$transaction.mockImplementation(async callback => callback(prismaClient))
  return prismaClient
}

const buildContext = () => {
  const prismaClient = buildPrismaClient()
  const prismaProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
  } as unknown as IDatabaseClientProvider

  const outboxDispatcher = {
    enqueueQueue: jest.fn(),
    enqueueWebhook: jest.fn(),
  }
  const orphanRefundService = {
    refundOrphanPayment: jest.fn().mockResolvedValue({
      outcome: 'refunded',
      refundTransactionId: null,
    }),
  }
  const depositVerifierRegistry = {
    getVerifier: jest.fn(),
  }
  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => ''),
    getSecrets: jest.fn(),
  }

  const logger: MockLogger = createMockLogger()

  return {
    controller: new PublicTransactionsController(
      prismaProvider,
      logger,
      outboxDispatcher as never,
      depositVerifierRegistry as never,
      orphanRefundService as never,
      { listEnabledAssets: jest.fn(async () => []) } as never,
      secretManager,
    ),
    logger,
    orphanRefundService,
    outboxDispatcher,
    prismaClient,
  }
}

describe('PublicTransactionsController.checkExpiredTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns early when no expired transactions are found', async () => {
    const { controller, logger, prismaClient } = buildContext()
    prismaClient.transaction.count.mockResolvedValueOnce(2)
    prismaClient.transaction.findMany.mockResolvedValueOnce([])

    const result = await controller.checkExpiredTransactions()

    expect(result).toEqual({
      awaiting: 2,
      expired: 0,
      updated: 0,
      updatedTransactionIds: [],
    })
    expect(prismaClient.transaction.updateMany).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('[PublicTransactionsController] No expired transactions found')
  })

  it('marks expired transactions and handles partial failures gracefully', async () => {
    const { controller, logger, outboxDispatcher, prismaClient } = buildContext()
    const expiredTransactions: TransactionFixture[] = [
      {
        id: 'tx-1',
        partnerUser: {
          partner: { id: 'p1', name: 'Partner 1', webhookUrl: 'http://webhook-1' },
          userId: 'user-1',
        },
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          expirationDate: new Date(Date.now() - 1_000),
          network: BlockchainNetwork.STELLAR,
          paymentMethod: PaymentMethod.BREB,
          sourceAmount: 100,
          targetAmount: 200,
          targetCurrency: 'COP',
        },
        status: TransactionStatus.AWAITING_PAYMENT,
      },
      {
        id: 'tx-2',
        partnerUser: {
          partner: { id: 'p2', name: 'Partner 2', webhookUrl: 'http://webhook-2' },
          userId: 'user-2',
        },
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          expirationDate: new Date(Date.now() - 2_000),
          network: BlockchainNetwork.STELLAR,
          paymentMethod: PaymentMethod.BREB,
          sourceAmount: 50,
          targetAmount: 120,
          targetCurrency: 'COP',
        },
        status: TransactionStatus.AWAITING_PAYMENT,
      },
      {
        id: 'tx-3',
        partnerUser: {
          partner: { id: 'p3', name: 'Partner 3', webhookUrl: 'http://webhook-3' },
          userId: 'user-3',
        },
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          expirationDate: new Date(Date.now() - 3_000),
          network: BlockchainNetwork.STELLAR,
          paymentMethod: PaymentMethod.PIX,
          sourceAmount: 75,
          targetAmount: 150,
          targetCurrency: 'COP',
        },
        status: TransactionStatus.AWAITING_PAYMENT,
      },
    ]

    prismaClient.transaction.count.mockResolvedValueOnce(expiredTransactions.length)
    prismaClient.transaction.findMany.mockResolvedValueOnce(expiredTransactions)
    prismaClient.transaction.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      return expiredTransactions.find(tx => tx.id === where.id) ?? null
    })
    prismaClient.transaction.update.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const current = expiredTransactions.find(tx => tx.id === where.id)
      return current ? { ...current, status: TransactionStatus.PAYMENT_EXPIRED } : null
    })
    prismaClient.transaction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ count: 0 })

    const webhookMock = outboxDispatcher.enqueueWebhook as unknown as jest.Mock
    webhookMock.mockRejectedValueOnce(new Error('webhook down')).mockResolvedValue(undefined)

    const queueMock = outboxDispatcher.enqueueQueue as unknown as jest.Mock
    queueMock.mockRejectedValueOnce(new Error('ws failed')).mockResolvedValue(undefined)

    const result = await controller.checkExpiredTransactions()

    expect(prismaClient.transaction.update).toHaveBeenCalledTimes(expiredTransactions.length)
    expect(outboxDispatcher.enqueueWebhook).toHaveBeenCalledTimes(expiredTransactions.length)
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(QueueName.USER_NOTIFICATION, expect.anything(), expect.any(String), expect.any(Object))
    expect(logger.warn).toHaveBeenCalled()
    expect(result).toEqual({
      awaiting: expiredTransactions.length,
      expired: expiredTransactions.length,
      updated: expiredTransactions.length,
      updatedTransactionIds: expiredTransactions.map(tx => tx.id),
    })
  })
})
