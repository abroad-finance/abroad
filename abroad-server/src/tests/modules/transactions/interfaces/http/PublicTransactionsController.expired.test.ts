import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TransactionStatus } from '.prisma/client'

import { PublicTransactionsController } from '../../../../../modules/transactions/interfaces/http/PublicTransactionsController'
import { QueueName } from '../../../../../platform/messaging/queues'
import { IWebhookNotifier } from '../../../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../../platform/secrets/ISecretManager'
import { createMockLogger, createMockQueueHandler, type MockLogger, type MockQueueHandler } from '../../../../setup/mockFactories'

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

const buildPrismaClient = () => ({
  transaction: {
    count: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
})

const buildContext = () => {
  const prismaClient = buildPrismaClient()
  const prismaProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
  } as unknown as IDatabaseClientProvider

  const webhookNotifier: IWebhookNotifier = {
    notifyWebhook: jest.fn(async () => undefined),
  }

  const queueHandler: MockQueueHandler = createMockQueueHandler()

  const secretManager: ISecretManager = {
    getSecret: jest.fn(async () => ''),
    getSecrets: jest.fn(),
  }

  const logger: MockLogger = createMockLogger()

  return {
    controller: new PublicTransactionsController(
      prismaProvider,
      logger,
      webhookNotifier,
      queueHandler,
      secretManager,
    ),
    logger,
    prismaClient,
    queueHandler,
    webhookNotifier,
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
    const { controller, logger, prismaClient, queueHandler, webhookNotifier } = buildContext()
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
          paymentMethod: PaymentMethod.NEQUI,
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
          paymentMethod: PaymentMethod.MOVII,
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
    prismaClient.transaction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ count: 0 })

    const webhookMock = webhookNotifier.notifyWebhook as unknown as jest.Mock
    webhookMock.mockRejectedValueOnce(new Error('webhook down')).mockResolvedValue(undefined)

    const queueMock = queueHandler.postMessage as unknown as jest.Mock
    queueMock.mockRejectedValueOnce(new Error('ws failed')).mockResolvedValue(undefined)

    const result = await controller.checkExpiredTransactions()

    expect(prismaClient.transaction.updateMany).toHaveBeenCalledTimes(expiredTransactions.length)
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledTimes(1)
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.USER_NOTIFICATION, expect.anything())
    expect(logger.warn).toHaveBeenCalled()
    expect(result).toEqual({
      awaiting: expiredTransactions.length,
      expired: expiredTransactions.length,
      updated: 1,
      updatedTransactionIds: ['tx-1'],
    })
  })
})
