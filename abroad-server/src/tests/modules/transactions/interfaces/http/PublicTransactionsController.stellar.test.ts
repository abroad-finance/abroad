import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '.prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import * as StellarSdk from '@stellar/stellar-sdk'

import { PublicTransactionsController } from '../../../../../modules/transactions/interfaces/http/PublicTransactionsController'
import { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secret, Secrets } from '../../../../../platform/secrets/ISecretManager'
import { createMockLogger, type MockLogger } from '../../../../setup/mockFactories'

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk')

  let currentRecords: unknown[] = []
  let currentOperation: Horizon.ServerApi.OperationRecord | null = null
  let currentOperationError: null | unknown = null
  const paymentRequest = {
    call: jest.fn(async () => ({ records: currentRecords })),
    cursor: jest.fn().mockReturnThis(),
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
  }
  const operationCall = {
    call: jest.fn(async () => {
      if (currentOperationError) {
        throw currentOperationError
      }
      if (!currentOperation) {
        throw new Error('No operation response configured')
      }
      return currentOperation
    }),
  }
  const operationsRequest = {
    operation: jest.fn(() => operationCall),
  }

  const mockServer = {
    operations: jest.fn(() => operationsRequest),
    payments: jest.fn(() => paymentRequest),
  }

  return {
    ...actual,
    __getMockServer: () => mockServer,
    __getOperationCall: () => operationCall,
    __getOperationsRequest: () => operationsRequest,
    __getPaymentRequest: () => paymentRequest,
    __resetOperationState: () => {
      currentOperation = null
      currentOperationError = null
    },
    __setOperationError: (error: unknown) => {
      currentOperationError = error
      currentOperation = null
    },
    __setOperationResponse: (operation: Horizon.ServerApi.OperationRecord) => {
      currentOperation = operation
      currentOperationError = null
    },
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
  __getMockServer: () => { operations: jest.Mock, payments: jest.Mock }
  __getOperationCall: () => { call: jest.Mock }
  __getOperationsRequest: () => { operation: jest.Mock }
  __getPaymentRequest: () => {
    call: jest.Mock
    cursor: jest.Mock
    forAccount: jest.Mock
    limit: jest.Mock
    order: jest.Mock
  }
  __resetOperationState: () => void
  __setOperationError: (error: unknown) => void
  __setOperationResponse: (operation: Horizon.ServerApi.OperationRecord) => void
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
const stellarUsdcIssuer = 'usdc-issuer'
const secrets: Record<string, string> = {
  STELLAR_ACCOUNT_ID: 'stellar-account',
  STELLAR_HORIZON_URL: 'http://horizon.local',
}

const mockedStellar = StellarSdk as unknown as MockedStellarModule
const serverConstructor = Horizon.Server as unknown as jest.Mock<unknown, [string?]>

const resetStellarMocks = (): void => {
  mockedStellar.__setPaymentRecords([])
  mockedStellar.__resetOperationState()
  const operationCall = mockedStellar.__getOperationCall()
  operationCall.call.mockClear()
  const operationsRequest = mockedStellar.__getOperationsRequest()
  operationsRequest.operation.mockClear()
  const paymentRequest = mockedStellar.__getPaymentRequest()
  paymentRequest.call.mockClear()
  paymentRequest.cursor.mockClear()
  paymentRequest.forAccount.mockClear()
  paymentRequest.limit.mockClear()
  paymentRequest.order.mockClear()
  mockedStellar.__getMockServer().payments.mockClear()
  mockedStellar.__getMockServer().operations.mockClear()
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
  asset_issuer: stellarUsdcIssuer,
  asset_type: 'credit_alphanum4',
  created_at: '',
  from: 'sender',
  id: 'payment-base',
  paging_token: '100',
  to: secrets[Secrets.STELLAR_ACCOUNT_ID],
  transaction: async () => ({
    id: 'tx-hash',
    memo: memoBase64,
  } as unknown as Horizon.ServerApi.TransactionRecord),
  transaction_hash: 'tx-hash',
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

  const outboxDispatcher = {
    enqueueQueue: jest.fn(),
    enqueueWebhook: jest.fn(),
  }
  const verifyNotification = jest.fn(async (transactionHash: string, transactionId: string) => ({
    outcome: 'ok' as const,
    queueMessage: {
      addressFrom: 'sender',
      amount: 1,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: transactionHash,
      transactionId,
    },
  }))
  const depositVerifierRegistry = {
    getVerifier: jest.fn(() => ({ verifyNotification })),
  }

  const orphanRefundService = {
    refundOrphanPayment: jest.fn().mockResolvedValue({
      outcome: 'refunded',
      refundTransactionId: 'mock-refund-id',
    }),
  }

  const secretManager: ISecretManager = {
    getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? 'unused'),
    getSecrets: jest.fn(),
  }
  const assetConfigService = {
    listEnabledAssets: jest.fn(async () => ([
      {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        mintAddress: stellarUsdcIssuer,
      },
    ])),
  }

  const logger: MockLogger = createMockLogger()

  return {
    controller: new PublicTransactionsController(
      prismaProvider,
      logger,
      outboxDispatcher as never,
      depositVerifierRegistry as never,
      orphanRefundService as never,
      assetConfigService as never,
      secretManager,
    ),
    logger,
    orphanRefundService,
    outboxDispatcher,
    prismaClient,
    verifyNotification,
  }
}

describe('PublicTransactionsController.checkUnprocessedStellarTransactions', () => {
  beforeEach(() => {
    resetStellarMocks()
    jest.clearAllMocks()
  })

  it('enqueues missing Stellar payments and advances the cursor', async () => {
    const { controller, outboxDispatcher, prismaClient } = buildContext()
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

    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledTimes(1)
    expect(prismaClient.transaction.findUnique).toHaveBeenCalledWith({
      select: { id: true, refundOnChainId: true, status: true },
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
    const { controller, outboxDispatcher, prismaClient } = buildContext()
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
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
    expect(serverConstructor).not.toHaveBeenCalled()
  })

  it('skips non-USDC payments and halts on queue failures while keeping the cursor', async () => {
    const { controller, logger, outboxDispatcher, prismaClient } = buildContext()
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
      transaction: async () => ({
        id: 'tx-hash',
        memo: altMemoBase64,
      } as unknown as Horizon.ServerApi.TransactionRecord),
    })

    const failingPayment = buildPayment({
      amount: '5',
      from: 'sender-2',
      id: 'payment-2',
      paging_token: '175',
      transaction: async () => ({
        id: 'tx-hash',
        memo: altMemoBase64,
      } as unknown as Horizon.ServerApi.TransactionRecord),
    })

    mockedStellar.__setPaymentRecords([nonUsdcPayment, failingPayment])
    const queueMock = outboxDispatcher.enqueueQueue as unknown as jest.Mock
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
