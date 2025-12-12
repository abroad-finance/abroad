import 'reflect-metadata'
import { TransactionStatus } from '.prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import * as StellarSdk from '@stellar/stellar-sdk'

import { PublicTransactionsController } from '../../controllers/PublicTransactionsController'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secret, Secrets } from '../../interfaces/ISecretManager'
import { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'
import { createMockLogger, createMockQueueHandler, type MockLogger, type MockQueueHandler } from '../setup/mockFactories'

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
  __getMockServer: () => { payments: jest.Mock }
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

const transactionId = '123e4567-e89b-12d3-a456-426614174000'
const memoBase64 = Buffer.from(transactionId.replace(/-/g, ''), 'hex').toString('base64')
const secrets: Record<string, string> = {
  STELLAR_ACCOUNT_ID: 'stellar-account',
  STELLAR_HORIZON_URL: 'http://horizon.local',
  STELLAR_USDC_ISSUER: 'usdc-issuer',
}

const mockedStellar = StellarSdk as unknown as MockedStellarModule
const serverConstructor = Horizon.Server as unknown as jest.Mock<unknown, [string?]>

const resetStellarMocks = (): void => {
  mockedStellar.__setPaymentRecords([])
  const paymentRequest = mockedStellar.__getPaymentRequest()
  paymentRequest.call.mockClear()
  paymentRequest.cursor.mockClear()
  paymentRequest.forAccount.mockClear()
  paymentRequest.limit.mockClear()
  paymentRequest.order.mockClear()
  mockedStellar.__getMockServer().payments.mockClear()
  serverConstructor.mockClear()
}

const basePayment: Horizon.ServerApi.PaymentOperationRecord = {
  _links: {
    effects: { href: '' },
    precedes: { href: '' },
    self: { href: '' },
    succeeds: { href: '' },
    transaction: { href: '' },
  },
  amount: '1',
  asset_code: 'USDC',
  asset_issuer: secrets[Secrets.STELLAR_USDC_ISSUER],
  asset_type: 'credit_alphanum4',
  created_at: '',
  from: 'sender',
  id: 'payment-base',
  paging_token: '100',
  to: secrets[Secrets.STELLAR_ACCOUNT_ID],
  transaction: async () => ({ memo: memoBase64 } as unknown as Horizon.ServerApi.TransactionRecord),
  type: Horizon.HorizonApi.OperationResponseType.payment,
  type_i: Horizon.HorizonApi.OperationResponseTypeI.payment,
} as unknown as Horizon.ServerApi.PaymentOperationRecord

const buildPayment = (
  overrides: Partial<Horizon.ServerApi.PaymentOperationRecord>,
): Horizon.ServerApi.PaymentOperationRecord => ({
  ...basePayment,
  ...overrides,
})

const buildContext = () => {
  const prismaClient: PrismaClientLike = {
    stellarListenerState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
    },
  }

  const prismaProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
  } as unknown as IDatabaseClientProvider

  const webhookNotifier: IWebhookNotifier = {
    notifyWebhook: jest.fn(async () => undefined),
  }

  const queueHandler: MockQueueHandler = createMockQueueHandler()

  const secretManager: ISecretManager = {
    getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? 'unused'),
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
  }
}

describe('PublicTransactionsController.checkUnprocessedStellarTransactions', () => {
  beforeEach(() => {
    resetStellarMocks()
    jest.clearAllMocks()
  })

  it('enqueues missing Stellar payments and advances the cursor', async () => {
    const { controller, prismaClient, queueHandler } = buildContext()
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

    mockedStellar.__setPaymentRecords([
      buildPayment({ amount: '50.5', id: 'payment-1', paging_token: '200' }),
    ])

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
    const { controller, prismaClient, queueHandler } = buildContext()
    prismaClient.stellarListenerState.findUnique.mockResolvedValueOnce(null)

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
    const { controller, logger, prismaClient, queueHandler } = buildContext()
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

    const altTransactionId = '11111111-1111-4111-8111-111111111111'
    const altMemoBase64 = Buffer.from(altTransactionId.replace(/-/g, ''), 'hex').toString('base64')
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: altTransactionId,
      onChainId: null,
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    const nonUsdcPayment = buildPayment({
      asset_code: 'XLM',
      asset_issuer: 'issuer',
      asset_type: 'native',
      from: 'sender-1',
      id: 'payment-1',
      paging_token: '150',
      transaction: async () => ({ memo: altMemoBase64 } as unknown as Horizon.ServerApi.TransactionRecord),
    })

    const failingPayment = buildPayment({
      amount: '5',
      from: 'sender-2',
      id: 'payment-2',
      paging_token: '175',
      transaction: async () => ({ memo: altMemoBase64 } as unknown as Horizon.ServerApi.TransactionRecord),
    })

    mockedStellar.__setPaymentRecords([nonUsdcPayment, failingPayment])
    const queueMock = queueHandler.postMessage as unknown as jest.Mock
    queueMock.mockRejectedValueOnce(new Error('queue down'))

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
      expect.objectContaining({ transactionId: altTransactionId }),
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
