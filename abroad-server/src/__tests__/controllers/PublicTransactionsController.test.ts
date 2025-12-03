/**
 * Unit tests for PublicTransactionsController.checkUnprocessedStellarTransactions.
 */
import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TransactionStatus } from '.prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import * as StellarSdk from '@stellar/stellar-sdk'

import { PublicTransactionsController } from '../../controllers/PublicTransactionsController'
import { QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secret, Secrets } from '../../interfaces/ISecretManager'
import { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../setup/mockFactories'

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk')

  let currentRecords: unknown[] = []
  const paymentRequest = {
    call: jest.fn(async () => ({ records: currentRecords })),
    cursor: jest.fn().mockReturnThis(),
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  }

  const mockServer = {
    payments: jest.fn(() => paymentRequest),
  }

  return {
    ...actual,
    __getMockServer: () => mockServer,
    __getPaymentRequest: () => paymentRequest,
    __setPaymentRecords: (records: unknown[]) => {
      currentRecords = records
    },
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn(() => mockServer),
    },
  }
})

type MockedStellarModule = typeof StellarSdk & {
  __getMockServer: () => {
    payments: jest.Mock
  }
  __getPaymentRequest: () => {
    call: jest.Mock
    cursor: jest.Mock
    forAccount: jest.Mock
    limit: jest.Mock
    order: jest.Mock
  }
  __setPaymentRecords: (records: Horizon.ServerApi.PaymentOperationRecord[]) => void
}

type PrismaClientLike = {
  stellarListenerState: {
    findUnique: jest.Mock
    upsert: jest.Mock
  }
  transaction: {
    findUnique: jest.Mock
  }
}

describe('PublicTransactionsController.checkUnprocessedStellarTransactions', () => {
  const transactionId = '123e4567-e89b-12d3-a456-426614174000'
  const memoBase64 = Buffer.from(transactionId.replace(/-/g, ''), 'hex').toString('base64')
  const secrets: Record<string, string> = {
    STELLAR_ACCOUNT_ID: 'stellar-account',
    STELLAR_HORIZON_URL: 'http://horizon.local',
    STELLAR_USDC_ISSUER: 'usdc-issuer',
  }

  let prismaClient: PrismaClientLike
  let prismaProvider: IDatabaseClientProvider
  let webhookNotifier: IWebhookNotifier
  let queueHandler: MockQueueHandler
  let secretManager: ISecretManager
  let logger: MockLogger
  let paymentRecords: Horizon.ServerApi.PaymentOperationRecord[]
  const mockedStellar = StellarSdk as unknown as MockedStellarModule
  const serverConstructor = Horizon.Server as unknown as jest.Mock<unknown, [string?]>

  beforeEach(() => {
    paymentRecords = []

    mockedStellar.__setPaymentRecords(paymentRecords)
    const paymentRequest = mockedStellar.__getPaymentRequest()
    paymentRequest.call.mockClear()
    paymentRequest.cursor.mockClear()
    paymentRequest.forAccount.mockClear()
    paymentRequest.limit.mockClear()
    paymentRequest.order.mockClear()
    mockedStellar.__getMockServer().payments.mockClear()
    serverConstructor.mockClear()

    prismaClient = {
      stellarListenerState: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      transaction: {
        findUnique: jest.fn(),
      },
    }

    prismaProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    webhookNotifier = {
      notifyWebhook: jest.fn(async () => undefined),
    } as IWebhookNotifier

    queueHandler = createMockQueueHandler()

    secretManager = {
      getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? 'unused'),
      getSecrets: jest.fn(),
    } as ISecretManager

    logger = createMockLogger()
  })

  it('enqueues missing Stellar payments and advances the cursor', async () => {
    prismaClient.stellarListenerState.findUnique.mockResolvedValueOnce({
      id: 'singleton',
      lastPagingToken: '100',
      updatedAt: new Date(),
    })

    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: transactionId,
      onChainId: null,
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    const payment: Horizon.ServerApi.PaymentOperationRecord = {
      _links: {
        effects: { href: '' },
        precedes: { href: '' },
        self: { href: '' },
        succeeds: { href: '' },
        transaction: { href: '' },
      },
      amount: '50.5',
      asset_code: 'USDC',
      asset_issuer: secrets[Secrets.STELLAR_USDC_ISSUER],
      asset_type: 'credit_alphanum4',
      created_at: '',
      from: 'sender-wallet',
      id: 'payment-1',
      paging_token: '200',
      to: secrets[Secrets.STELLAR_ACCOUNT_ID],
      transaction: async () => ({ memo: memoBase64 } as unknown as Horizon.ServerApi.TransactionRecord),
      type: Horizon.HorizonApi.OperationResponseType.payment,
      type_i: Horizon.HorizonApi.OperationResponseTypeI.payment,
    } as unknown as Horizon.ServerApi.PaymentOperationRecord

    paymentRecords.push(payment)

    const controller = new PublicTransactionsController(
      prismaProvider,
      webhookNotifier,
      queueHandler,
      secretManager,
      logger,
    )

    const result = await controller.checkUnprocessedStellarTransactions()

    expect(queueHandler.postMessage).toHaveBeenCalledTimes(1)
    expect(prismaClient.transaction.findUnique).toHaveBeenCalledWith({
      select: { id: true, onChainId: true, status: true },
      where: { id: transactionId },
    })
    expect(prismaClient.stellarListenerState.upsert).toHaveBeenCalledWith({
      create: { id: 'singleton', lastPagingToken: '200' },
      update: { lastPagingToken: '200' },
      where: { id: 'singleton' },
    })
    expect(result).toEqual({
      alreadyProcessed: 0,
      endPagingToken: '200',
      enqueued: 1,
      missingTransactions: 0,
      scannedPayments: 1,
      startPagingToken: '100',
    })
  })

  it('returns early when no Stellar cursor exists', async () => {
    prismaClient.stellarListenerState.findUnique.mockResolvedValueOnce(null)

    const controller = new PublicTransactionsController(
      prismaProvider,
      webhookNotifier,
      queueHandler,
      secretManager,
      logger,
    )

    const result = await controller.checkUnprocessedStellarTransactions()

    expect(result).toEqual({
      alreadyProcessed: 0,
      endPagingToken: null,
      enqueued: 0,
      missingTransactions: 0,
      scannedPayments: 0,
      startPagingToken: null,
    })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
    expect(serverConstructor).not.toHaveBeenCalled()
  })

  it('skips non-USDC payments and halts on queue failures while keeping the cursor', async () => {
    prismaClient.stellarListenerState.findUnique
      .mockResolvedValueOnce({
        id: 'singleton',
        lastPagingToken: '100',
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'singleton',
        lastPagingToken: '200',
        updatedAt: new Date(),
      })

    const transactionId = '11111111-1111-4111-8111-111111111111'
    const memoBase64 = Buffer.from(transactionId.replace(/-/g, ''), 'hex').toString('base64')

    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: transactionId,
      onChainId: null,
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    const nonUsdcPayment: Horizon.ServerApi.PaymentOperationRecord = {
      _links: {
        effects: { href: '' },
        precedes: { href: '' },
        self: { href: '' },
        succeeds: { href: '' },
        transaction: { href: '' },
      },
      amount: '1',
      asset_code: 'XLM',
      asset_issuer: 'issuer',
      asset_type: 'native',
      created_at: '',
      from: 'sender-1',
      id: 'payment-1',
      paging_token: '150',
      to: secrets[Secrets.STELLAR_ACCOUNT_ID],
      transaction: async () => ({ memo: memoBase64 } as unknown as Horizon.ServerApi.TransactionRecord),
      type: Horizon.HorizonApi.OperationResponseType.payment,
      type_i: Horizon.HorizonApi.OperationResponseTypeI.payment,
    } as unknown as Horizon.ServerApi.PaymentOperationRecord

    const failingPayment: Horizon.ServerApi.PaymentOperationRecord = {
      ...nonUsdcPayment,
      amount: '5',
      asset_code: 'USDC',
      asset_issuer: secrets[Secrets.STELLAR_USDC_ISSUER],
      asset_type: 'credit_alphanum4',
      from: 'sender-2',
      id: 'payment-2',
      paging_token: '175',
      transaction: async () => ({ memo: memoBase64 } as unknown as Horizon.ServerApi.TransactionRecord),
    }

    mockedStellar.__setPaymentRecords([nonUsdcPayment, failingPayment])
    const queueMock = queueHandler.postMessage as unknown as jest.Mock
    queueMock.mockRejectedValueOnce(new Error('queue down'))

    const controller = new PublicTransactionsController(
      prismaProvider,
      webhookNotifier,
      queueHandler,
      secretManager,
      logger,
    )

    const result = await controller.checkUnprocessedStellarTransactions()

    expect(result).toEqual({
      alreadyProcessed: 0,
      endPagingToken: '150',
      enqueued: 0,
      missingTransactions: 0,
      scannedPayments: 2,
      startPagingToken: '100',
    })
    expect(logger.error).toHaveBeenCalledWith(
      '[PublicTransactionsController] Failed to enqueue recovered Stellar payment',
      expect.objectContaining({ transactionId }),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      '[PublicTransactionsController] Skipped cursor update because a newer cursor already exists',
      {
        existingCursor: '200',
        proposedCursor: '150',
      },
    )
    expect(prismaClient.stellarListenerState.upsert).not.toHaveBeenCalled()
  })
})

describe('PublicTransactionsController.checkExpiredTransactions', () => {
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

  let prismaClient: {
    transaction: {
      count: jest.Mock
      findMany: jest.Mock
      updateMany: jest.Mock
    }
  }
  let prismaProvider: IDatabaseClientProvider
  let webhookNotifier: IWebhookNotifier
  let queueHandler: MockQueueHandler
  let secretManager: ISecretManager
  let logger: MockLogger

  beforeEach(() => {
    prismaClient = {
      transaction: {
        count: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    }

    prismaProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    webhookNotifier = {
      notifyWebhook: jest.fn(async () => undefined),
    } as IWebhookNotifier

    queueHandler = createMockQueueHandler()

    secretManager = {
      getSecret: jest.fn(async () => ''),
      getSecrets: jest.fn(),
    } as ISecretManager

    logger = createMockLogger()
  })

  it('returns early when no expired transactions are found', async () => {
    prismaClient.transaction.count.mockResolvedValueOnce(2)
    prismaClient.transaction.findMany.mockResolvedValueOnce([])

    const controller = new PublicTransactionsController(
      prismaProvider,
      webhookNotifier,
      queueHandler,
      secretManager,
      logger,
    )

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

    const controller = new PublicTransactionsController(
      prismaProvider,
      webhookNotifier,
      queueHandler,
      secretManager,
      logger,
    )

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
