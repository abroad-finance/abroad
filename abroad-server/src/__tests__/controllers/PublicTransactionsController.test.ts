/**
 * Unit tests for PublicTransactionsController.checkUnprocessedStellarTransactions.
 */
import 'reflect-metadata'
import { TransactionStatus } from '.prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import * as StellarSdk from '@stellar/stellar-sdk'

import { PublicTransactionsController } from '../../controllers/PublicTransactionsController'
import { IQueueHandler } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ILogger } from '../../interfaces/index'
import { ISecretManager, Secret, Secrets } from '../../interfaces/ISecretManager'
import { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'

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
  let queueHandler: IQueueHandler
  let secretManager: ISecretManager
  let logger: ILogger
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

    queueHandler = {
      postMessage: jest.fn(async () => undefined),
      subscribeToQueue: jest.fn(async () => undefined),
    } as IQueueHandler

    secretManager = {
      getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? 'unused'),
      getSecrets: jest.fn(),
    } as ISecretManager

    logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }
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
})
