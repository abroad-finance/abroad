import { BlockchainNetwork, CryptoCurrency, PrismaClient } from '@prisma/client'
import * as StellarSdk from '@stellar/stellar-sdk'

import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { StellarListener } from '../../../../../modules/treasury/interfaces/listeners/StellarListener'
import { QueueName, ReceivedCryptoTransactionMessage } from '../../../../../platform/messaging/queues'
import { createMockLogger } from '../../../../setup/mockFactories'

interface HorizonMocks {
  cursor: jest.Mock
  forAccount: jest.Mock
  payments: jest.Mock
  streamHandle: { close: jest.Mock }
  streamHandlers: StreamHandlers[]
}

interface StreamHandlers {
  onerror?: (err: unknown) => void
  onmessage?: (payment: TestPayment) => Promise<void> | void
}

interface TestPayment {
  amount: string
  asset_code: string
  asset_issuer: null | string
  asset_type: string
  from: string
  id: string
  paging_token: string
  to: string
  transaction: () => Promise<{ id?: string, memo?: string }>
  transaction_hash?: string
  type: string
}

jest.mock('@stellar/stellar-sdk', () => {
  const streamHandlers: Array<{ onerror?: (err: unknown) => void, onmessage?: (payment: unknown) => Promise<void> | void }> = []
  const streamHandle = { close: jest.fn() }
  const stream = jest.fn((handlers: { onerror?: (err: unknown) => void, onmessage?: (payment: unknown) => Promise<void> | void }) => {
    streamHandlers.push(handlers)
    return streamHandle
  })
  const forAccount = jest.fn(() => ({ stream }))
  const cursor = jest.fn(() => ({ forAccount }))
  const payments = jest.fn(() => ({ cursor, forAccount }))

  class MockServer {
    public payments = payments
  }

  return {
    Horizon: { Server: MockServer },
    stellarMocks: { cursor, forAccount, payments, streamHandle, streamHandlers },
  }
})

const stellarMocks = (StellarSdk as unknown as { stellarMocks: HorizonMocks }).stellarMocks

beforeEach(() => {
  resetHorizonMocks()
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.clearAllMocks()
})

function createDbProvider(state: null | { lastPagingToken?: string } = null) {
  const findUnique = jest.fn().mockResolvedValue(state)
  const upsert = jest.fn().mockResolvedValue(undefined)
  const prisma = {
    stellarListenerState: {
      findUnique,
      upsert,
    },
  } as unknown as PrismaClient

  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prisma),
  }

  return { dbProvider, findUnique, upsert }
}

function createDepositVerifierRegistry() {
  const verifyNotification = jest.fn(async (paymentId: string, transactionId: string) => ({
    outcome: 'ok',
    queueMessage: {
      addressFrom: 'sender',
      amount: 1,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: paymentId,
      transactionId,
    } as ReceivedCryptoTransactionMessage,
  }))

  return {
    getVerifier: jest.fn(() => ({ verifyNotification })),
    verifyNotification,
  }
}

function createOrphanRefundService() {
  const refundOrphanPayment = jest.fn().mockResolvedValue({
    outcome: 'refunded',
    refundTransactionId: 'refund-on-chain',
  })
  return { refundOrphanPayment }
}

function createOutboxDispatcher(enqueueQueue?: jest.Mock) {
  return { enqueueQueue: enqueueQueue ?? jest.fn() }
}

function createPayment(overrides: Partial<TestPayment> = {}): TestPayment {
  const transaction = overrides.transaction
    ?? (() => Promise.resolve({
      id: 'tx-hash',
      memo: Buffer.from('00112233445566778899aabbccddeeff', 'hex').toString('base64'),
    }))
  return {
    amount: overrides.amount ?? '10.5',
    asset_code: overrides.asset_code ?? 'USDC',
    asset_issuer: overrides.asset_issuer ?? 'issuer',
    asset_type: overrides.asset_type ?? 'credit_alphanum4',
    from: overrides.from ?? 'sender',
    id: overrides.id ?? 'payment-id',
    paging_token: overrides.paging_token ?? 'paging-token',
    to: overrides.to ?? 'account-id',
    transaction,
    transaction_hash: overrides.transaction_hash,
    type: overrides.type ?? 'payment',
  }
}

function createSecretManager(accountId = 'account-id', horizonUrl = 'https://horizon'): ISecretManager {
  const values: Record<string, string> = {
    STELLAR_ACCOUNT_ID: accountId,
    STELLAR_HORIZON_URL: horizonUrl,
  }
  const getSecrets: jest.MockedFunction<ISecretManager['getSecrets']> = jest.fn(async (secretNames) => {
    const entries = secretNames.map(secretName => [secretName, values[secretName] ?? ''] as const)
    return Object.fromEntries(entries) as Record<(typeof secretNames)[number], string>
  })
  return {
    getSecret: jest.fn()
      .mockResolvedValueOnce(accountId)
      .mockResolvedValueOnce(horizonUrl),
    getSecrets,
  }
}

function resetHorizonMocks() {
  stellarMocks.cursor.mockClear()
  stellarMocks.forAccount.mockClear()
  stellarMocks.payments.mockClear()
  stellarMocks.streamHandle.close.mockClear()
  stellarMocks.streamHandlers.splice(0, stellarMocks.streamHandlers.length)
}

function setupHorizonMock(): HorizonMocks {
  resetHorizonMocks()
  return stellarMocks
}

describe('StellarListener', () => {
  it('converts base64 memos to UUIDs', () => {
    const base64Memo = Buffer.from('00112233445566778899aabbccddeeff', 'hex').toString('base64')
    const { base64ToUuid } = StellarListener as unknown as { base64ToUuid: (value: string) => string }

    expect(base64ToUuid(base64Memo)).toBe('00112233-4455-6677-8899-aabbccddeeff')
  })

  it('skips non-payment operations while preserving paging tokens', async () => {
    const horizonMocks = setupHorizonMock()
    const outboxDispatcher = createOutboxDispatcher()
    const secretManager = createSecretManager()
    const { dbProvider, findUnique, upsert } = createDbProvider({ lastPagingToken: 'cursor-1' })
    const { getVerifier } = createDepositVerifierRegistry()
    const orphanRefundService = createOrphanRefundService()

    const listener = new StellarListener(
      outboxDispatcher as never,
      secretManager,
      dbProvider,
      { getVerifier } as never,
      orphanRefundService as never,
      { listEnabledAssets: jest.fn(async () => [{ cryptoCurrency: CryptoCurrency.USDC, mintAddress: 'trusted-issuer' }]) } as never,
      createMockLogger(),
    )
    await listener.start()

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' } })
    expect(horizonMocks.cursor).toHaveBeenCalledWith('cursor-1')

    const handler = horizonMocks.streamHandlers[0]
    await handler.onmessage?.(createPayment({ paging_token: 'new-token', type: 'create_account' }))

    expect(upsert).toHaveBeenCalledWith({
      create: { id: 'singleton', lastPagingToken: 'new-token' },
      update: { lastPagingToken: 'new-token' },
      where: { id: 'singleton' },
    })
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()

    listener.stop()
    expect(horizonMocks.streamHandle.close).toHaveBeenCalled()
  })

  it('filters unsupported assets and memo-less payments before publishing', async () => {
    const horizonMocks = setupHorizonMock()
    const enqueueQueue: jest.Mock = jest.fn()
    enqueueQueue.mockImplementationOnce(() => {
      throw new Error('queue down')
    })
    enqueueQueue.mockResolvedValue(undefined)
    const outboxDispatcher = createOutboxDispatcher(enqueueQueue)
    const secretManager = createSecretManager('account-id', 'https://horizon')
    const { dbProvider, upsert } = createDbProvider()
    const { getVerifier, verifyNotification } = createDepositVerifierRegistry()
    const orphanRefundService = createOrphanRefundService()

    const listener = new StellarListener(
      outboxDispatcher as never,
      secretManager,
      dbProvider,
      { getVerifier } as never,
      orphanRefundService as never,
      { listEnabledAssets: jest.fn(async () => [{ cryptoCurrency: CryptoCurrency.USDC, mintAddress: 'trusted-issuer' }]) } as never,
      createMockLogger(),
    )
    await listener.start()

    const handler = horizonMocks.streamHandlers[0]

    await handler.onmessage?.(createPayment({ to: 'other-account' }))
    await handler.onmessage?.(createPayment({ asset_issuer: 'untrusted' }))
    await handler.onmessage?.(createPayment({
      asset_issuer: 'trusted-issuer',
      transaction: () => Promise.resolve({ id: 'tx-hash', memo: undefined }),
    }))

    const validMemo = Buffer.from('12345678123456781234567812345678', 'hex').toString('base64')
    await handler.onmessage?.(createPayment({
      asset_issuer: 'trusted-issuer',
      paging_token: 'valid-token',
      transaction: () => Promise.resolve({ id: 'tx-hash', memo: validMemo }),
    }))

    expect(upsert).toHaveBeenCalledTimes(4)
    expect(orphanRefundService.refundOrphanPayment).toHaveBeenCalledTimes(1)
    expect(enqueueQueue).toHaveBeenCalledTimes(1)
    const queuedPayload = enqueueQueue.mock.calls[0][1] as ReceivedCryptoTransactionMessage
    expect(enqueueQueue).toHaveBeenCalledWith(QueueName.RECEIVED_CRYPTO_TRANSACTION, queuedPayload, 'stellar.listener', { deliverNow: true })
    expect(queuedPayload.transactionId).toBe('12345678-1234-5678-1234-567812345678')
    expect(verifyNotification).toHaveBeenCalledWith('tx-hash', '12345678-1234-5678-1234-567812345678')

    listener.stop()
    expect(horizonMocks.streamHandle.close).toHaveBeenCalled()
  })

  it('clears keep-alives and supports function-based stream cancellation on stop', () => {
    const outboxDispatcher = createOutboxDispatcher()
    const secretManager = createSecretManager()
    const { dbProvider } = createDbProvider()
    const orphanRefundService = createOrphanRefundService()
    const listener = new StellarListener(
      outboxDispatcher as never,
      secretManager,
      dbProvider,
      { getVerifier: jest.fn() } as never,
      orphanRefundService as never,
      { listEnabledAssets: jest.fn(async () => [{ cryptoCurrency: CryptoCurrency.USDC, mintAddress: 'trusted-issuer' }]) } as never,
      createMockLogger(),
    )

    const cancel = jest.fn()
    const internals = listener as unknown as { keepAlive?: NodeJS.Timeout, stream?: unknown }
    internals.keepAlive = setInterval(() => undefined, 1000)
    internals.stream = cancel

    listener.stop()

    expect(cancel).toHaveBeenCalled()
    expect(internals.keepAlive).toBeUndefined()
    expect(internals.stream).toBeUndefined()
  })
})
