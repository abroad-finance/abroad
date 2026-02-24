import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PrismaClient, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import * as StellarSdk from '@stellar/stellar-sdk'

import { IDepositVerifierRegistry } from '../../../../modules/payments/application/contracts/IDepositVerifier'
import { OpsTransactionReconciliationService } from '../../../../modules/transactions/application/OpsTransactionReconciliationService'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secret, Secrets } from '../../../../platform/secrets/ISecretManager'
import { createMockLogger } from '../../../setup/mockFactories'

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk')
  const transactionCall = { call: jest.fn() }
  const transactionsRequest = {
    transaction: jest.fn(() => transactionCall),
  }
  const mockServer = {
    transactions: jest.fn(() => transactionsRequest),
  }

  return {
    ...actual,
    __getMockServer: () => mockServer,
    __getTransactionCall: () => transactionCall,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn(() => mockServer),
    },
  }
})

type MockedStellarModule = typeof StellarSdk & {
  __getMockServer: () => {
    transactions: jest.Mock
  }
  __getTransactionCall: () => {
    call: jest.Mock
  }
}

type PrismaClientLike = {
  transaction: {
    findUnique: jest.Mock
  }
}

const mockedStellar = StellarSdk as unknown as MockedStellarModule
const serverConstructor = Horizon.Server as unknown as jest.Mock<unknown, [string?]>

const resetStellarMocks = () => {
  mockedStellar.__getMockServer().transactions.mockClear()
  mockedStellar.__getTransactionCall().call.mockClear()
  serverConstructor.mockClear()
}

const transactionId = '123e4567-e89b-12d3-a456-426614174000'
const memoBase64 = Buffer.from(transactionId.replace(/-/g, ''), 'hex').toString('base64')

const buildContext = () => {
  const prismaClient: PrismaClientLike = {
    transaction: {
      findUnique: jest.fn(),
    },
  }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prismaClient as unknown as PrismaClient),
  } as unknown as IDatabaseClientProvider

  const verifyNotification = jest.fn()
  const verifierRegistry: IDepositVerifierRegistry = {
    getVerifier: jest.fn(() => ({
      supportedNetwork: BlockchainNetwork.STELLAR,
      verifyNotification,
    })),
  }

  const outboxDispatcher = {
    enqueueQueue: jest.fn(),
  } as unknown as OutboxDispatcher

  const secretManager: ISecretManager = {
    getSecret: jest.fn(async (secret: Secret) => {
      if (secret === Secrets.STELLAR_HORIZON_URL) {
        return 'http://horizon.local'
      }
      return 'unused'
    }),
    getSecrets: jest.fn(),
  }

  const logger = createMockLogger()
  const service = new OpsTransactionReconciliationService(
    dbProvider,
    verifierRegistry,
    outboxDispatcher,
    secretManager,
    logger,
  )

  return {
    logger,
    outboxDispatcher,
    prismaClient,
    service,
    verifierRegistry,
    verifyNotification,
  }
}

describe('OpsTransactionReconciliationService', () => {
  beforeEach(() => {
    resetStellarMocks()
    jest.clearAllMocks()
  })

  it('returns alreadyProcessed when hash is already linked', async () => {
    const { prismaClient, service, verifyNotification } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      id: transactionId,
      status: TransactionStatus.PAYMENT_COMPLETED,
    })

    const result = await service.reconcileHash({
      blockchain: BlockchainNetwork.STELLAR,
      onChainTx: 'stellar-hash',
    })

    expect(result).toEqual({
      blockchain: BlockchainNetwork.STELLAR,
      onChainTx: 'stellar-hash',
      result: 'alreadyProcessed',
      transactionId,
      transactionStatus: TransactionStatus.PAYMENT_COMPLETED,
    })
    expect(verifyNotification).not.toHaveBeenCalled()
  })

  it('returns unresolved for non-Stellar hashes without transaction_id', async () => {
    const { prismaClient, service } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(null)

    const result = await service.reconcileHash({
      blockchain: BlockchainNetwork.SOLANA,
      onChainTx: 'solana-hash',
    })

    expect(result).toEqual({
      blockchain: BlockchainNetwork.SOLANA,
      onChainTx: 'solana-hash',
      reason: 'transaction_id is required when hash is not linked',
      result: 'unresolved',
      transactionId: null,
      transactionStatus: null,
    })
  })

  it('returns notFound for missing Stellar transaction hashes', async () => {
    const { prismaClient, service, verifyNotification } = buildContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(null)
    const notFoundError = Object.assign(new Error('missing'), { response: { status: 404 } })
    mockedStellar.__getTransactionCall().call.mockRejectedValueOnce(notFoundError)

    const result = await service.reconcileHash({
      blockchain: BlockchainNetwork.STELLAR,
      onChainTx: 'missing-hash',
    })

    expect(result).toEqual({
      blockchain: BlockchainNetwork.STELLAR,
      onChainTx: 'missing-hash',
      reason: 'Transaction not found on Stellar',
      result: 'notFound',
      transactionId: null,
      transactionStatus: null,
    })
    expect(verifyNotification).not.toHaveBeenCalled()
  })

  it('enqueues Stellar hashes when memo maps to a valid transaction id', async () => {
    const { outboxDispatcher, prismaClient, service, verifyNotification } = buildContext()
    prismaClient.transaction.findUnique.mockImplementation(async (
      args: { where: { id?: string, onChainId?: string } },
    ) => {
      if (args.where.onChainId) {
        return null
      }
      if (args.where.id === transactionId) {
        return { status: TransactionStatus.AWAITING_PAYMENT }
      }
      return null
    })

    mockedStellar.__getTransactionCall().call.mockResolvedValueOnce({
      memo: memoBase64,
    } as unknown as Horizon.ServerApi.TransactionRecord)

    verifyNotification.mockResolvedValueOnce({
      outcome: 'ok' as const,
      queueMessage: {
        addressFrom: 'sender',
        amount: 100,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'stellar-hash',
        transactionId,
      },
    })

    const result = await service.reconcileHash({
      blockchain: BlockchainNetwork.STELLAR,
      onChainTx: 'stellar-hash',
    })

    expect(verifyNotification).toHaveBeenCalledWith('stellar-hash', transactionId)
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ transactionId }),
      'ops.transactions.reconcile-hash',
      expect.objectContaining({ deliverNow: true }),
    )
    expect(result).toEqual({
      blockchain: BlockchainNetwork.STELLAR,
      onChainTx: 'stellar-hash',
      reason: undefined,
      result: 'enqueued',
      transactionId,
      transactionStatus: TransactionStatus.AWAITING_PAYMENT,
    })
  })
})
