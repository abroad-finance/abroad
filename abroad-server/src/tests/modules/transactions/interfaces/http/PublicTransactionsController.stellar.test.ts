import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '.prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import * as StellarSdk from '@stellar/stellar-sdk'

import { PublicTransactionsController } from '../../../../../modules/transactions/interfaces/http/PublicTransactionsController'
import { QueueName } from '../../../../../platform/messaging/queues'
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
const secrets: Record<string, string> = {
  STELLAR_ACCOUNT_ID: 'stellar-account',
  STELLAR_HORIZON_URL: 'http://horizon.local',
  STELLAR_RECONCILIATION_SECRET: 'stellar-reconcile-secret',
  STELLAR_USDC_ISSUER: 'usdc-issuer',
}
const reconciliationSecret = secrets[Secrets.STELLAR_RECONCILIATION_SECRET]

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

const nonPaymentOperation: Horizon.ServerApi.OperationRecord = {
  type: Horizon.HorizonApi.OperationResponseType.createAccount,
} as unknown as Horizon.ServerApi.OperationRecord

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
  const verifyNotification = jest.fn(async (paymentId: string, transactionId: string) => ({
    outcome: 'ok' as const,
    queueMessage: {
      addressFrom: 'sender',
      amount: 1,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: paymentId,
      transactionId,
    },
  }))
  const depositVerifierRegistry = {
    getVerifier: jest.fn(() => ({ verifyNotification })),
  }

  const secretManager: ISecretManager = {
    getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? 'unused'),
    getSecrets: jest.fn(),
  }

  const logger: MockLogger = createMockLogger()

  return {
    controller: new PublicTransactionsController(
      prismaProvider,
      logger,
      outboxDispatcher as never,
      depositVerifierRegistry as never,
      secretManager,
    ),
    logger,
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

describe('PublicTransactionsController.reconcileStellarPayment', () => {
  beforeEach(() => {
    resetStellarMocks()
    jest.clearAllMocks()
  })

  it('rejects missing reconciliation secret headers', async () => {
    const { controller, logger, outboxDispatcher } = buildContext()

    await expect(controller.reconcileStellarPayment('payment-1')).rejects.toThrow('Unauthorized')

    expect(logger.warn).toHaveBeenCalledWith('[PublicTransactionsController] Missing Stellar reconciliation secret header')
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
    expect(serverConstructor).not.toHaveBeenCalled()
  })

  it('rejects invalid reconciliation secret headers', async () => {
    const { controller, logger, outboxDispatcher } = buildContext()

    await expect(controller.reconcileStellarPayment('payment-1', 'wrong-secret')).rejects.toThrow('Unauthorized')

    expect(logger.warn).toHaveBeenCalledWith('[PublicTransactionsController] Invalid Stellar reconciliation secret header')
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
  })

  it('returns invalid when payment id is empty', async () => {
    const { controller, logger, outboxDispatcher } = buildContext()

    const result = await controller.reconcileStellarPayment('  ', reconciliationSecret)

    expect(result).toEqual({ paymentId: '  ', result: 'invalid', transactionId: null })
    expect(logger.warn).toHaveBeenCalledWith(
      '[PublicTransactionsController] Empty Stellar payment id provided for reconciliation',
      { paymentId: '  ' },
    )
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
    expect(serverConstructor).not.toHaveBeenCalled()
  })

  it('returns notFound when Horizon cannot locate the operation', async () => {
    const { controller, logger, outboxDispatcher, prismaClient } = buildContext()
    const notFoundError = Object.assign(new Error('missing'), { response: { status: 404 } })
    mockedStellar.__setOperationError(notFoundError)

    const result = await controller.reconcileStellarPayment('missing-payment', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'missing-payment', result: 'notFound', transactionId: null })
    expect(logger.error).not.toHaveBeenCalled()
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
  })

  it('returns invalid when Horizon rejects the operation id', async () => {
    const { controller, logger, prismaClient } = buildContext()
    const badRequestError: { status: number } = { status: 400 }
    mockedStellar.__setOperationError(badRequestError)

    const result = await controller.reconcileStellarPayment('bad-operation', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'bad-operation', result: 'invalid', transactionId: null })
    expect(logger.warn).toHaveBeenCalledWith(
      '[PublicTransactionsController] Invalid Stellar payment id supplied',
      { paymentId: 'bad-operation' },
    )
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns failed when Horizon errors unexpectedly', async () => {
    const { controller, logger } = buildContext()
    mockedStellar.__setOperationError(new Error('horizon down'))

    const result = await controller.reconcileStellarPayment('payment-error', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-error', result: 'failed', transactionId: null })
    expect(logger.error).toHaveBeenCalledWith(
      '[PublicTransactionsController] Failed to load Stellar payment for reconciliation',
      expect.objectContaining({ paymentId: 'payment-error' }),
    )
  })

  it('returns irrelevant when the operation is not a payment', async () => {
    const { controller, logger, prismaClient } = buildContext()
    mockedStellar.__setOperationResponse(nonPaymentOperation)

    const result = await controller.reconcileStellarPayment('operation-1', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'operation-1', result: 'irrelevant', transactionId: null })
    expect(logger.warn).toHaveBeenCalledWith(
      '[PublicTransactionsController] Stellar operation is not a direct payment',
      { operationType: nonPaymentOperation.type, paymentId: 'operation-1' },
    )
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns irrelevant when the payment is not USDC to the wallet', async () => {
    const { controller, prismaClient } = buildContext()
    mockedStellar.__setOperationResponse(buildPayment({
      asset_code: 'XLM',
      asset_issuer: 'issuer',
      asset_type: 'native',
      id: 'payment-xlm',
    }))

    const result = await controller.reconcileStellarPayment('payment-xlm', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-xlm', result: 'irrelevant', transactionId: null })
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns irrelevant when the payment memo is missing', async () => {
    const { controller, prismaClient } = buildContext()
    mockedStellar.__setOperationResponse(buildPayment({
      id: 'payment-missing-memo',
      transaction: async () => ({ memo: undefined } as unknown as Horizon.ServerApi.TransactionRecord),
    }))

    const result = await controller.reconcileStellarPayment('payment-missing-memo', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-missing-memo', result: 'irrelevant', transactionId: null })
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns failed when the payment transaction cannot be read', async () => {
    const { controller, logger, prismaClient } = buildContext()
    mockedStellar.__setOperationResponse(buildPayment({
      id: 'payment-bad-tx',
      transaction: async () => {
        throw new Error('tx fetch failed')
      },
    }))

    const result = await controller.reconcileStellarPayment('payment-bad-tx', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-bad-tx', result: 'failed', transactionId: null })
    expect(logger.error).toHaveBeenCalledWith(
      '[PublicTransactionsController] Failed to fetch/parse payment transaction',
      expect.objectContaining({ paymentId: 'payment-bad-tx' }),
    )
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns missing when no matching transaction exists', async () => {
    const { controller, prismaClient } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(null)
    mockedStellar.__setOperationResponse(buildPayment({ id: 'payment-missing' }))

    const result = await controller.reconcileStellarPayment('payment-missing', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-missing', result: 'missing', transactionId })
    expect(prismaClient.transaction.findUnique).toHaveBeenCalledWith({
      select: { id: true, refundOnChainId: true, status: true },
      where: { id: transactionId },
    })
  })

  it('returns alreadyProcessed when the transaction is not awaiting payment', async () => {
    const { controller, outboxDispatcher, prismaClient } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: transactionId,
      onChainId: 'stellar-hash',
      status: TransactionStatus.PAYMENT_COMPLETED,
    })
    mockedStellar.__setOperationResponse(buildPayment({ id: 'payment-processed' }))

    const result = await controller.reconcileStellarPayment('payment-processed', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-processed', result: 'alreadyProcessed', transactionId })
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
  })

  it('enqueues a matching payment and returns enqueued', async () => {
    const { controller, outboxDispatcher, prismaClient } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: transactionId,
      onChainId: null,
      status: TransactionStatus.AWAITING_PAYMENT,
    })
    mockedStellar.__setOperationResponse(buildPayment({
      amount: '42.5',
      from: 'sender-123',
      id: 'payment-enqueued',
    }))

    const result = await controller.reconcileStellarPayment('payment-enqueued', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-enqueued', result: 'enqueued', transactionId })
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      expect.objectContaining({ transactionId }),
      expect.any(String),
      expect.objectContaining({ deliverNow: true }),
    )
  })

  it('returns failed when enqueueing the payment fails', async () => {
    const { controller, logger, outboxDispatcher, prismaClient } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: transactionId,
      onChainId: null,
      status: TransactionStatus.AWAITING_PAYMENT,
    })
    const postMessage = outboxDispatcher.enqueueQueue as jest.Mock
    postMessage.mockRejectedValueOnce(new Error('queue down'))
    mockedStellar.__setOperationResponse(buildPayment({ id: 'payment-queue-failure' }))

    const result = await controller.reconcileStellarPayment('payment-queue-failure', reconciliationSecret)

    expect(result).toEqual({ paymentId: 'payment-queue-failure', result: 'failed', transactionId })
    expect(logger.error).toHaveBeenCalledWith(
      '[PublicTransactionsController] Failed to enqueue recovered Stellar payment',
      expect.objectContaining({ paymentId: 'payment-queue-failure', transactionId }),
    )
  })
})
