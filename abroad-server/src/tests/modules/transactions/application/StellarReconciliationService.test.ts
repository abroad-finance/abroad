import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { CryptoCurrency, TransactionStatus } from '@prisma/client'

import type { IDepositVerifierRegistry } from '../../../../modules/payments/application/contracts/IDepositVerifier'
import type { CryptoAssetConfigService } from '../../../../modules/payments/application/CryptoAssetConfigService'
import type { StellarOrphanRefundService } from '../../../../modules/transactions/application/StellarOrphanRefundService'
import type { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { StellarReconciliationService } from '../../../../modules/transactions/application/StellarReconciliationService'
import { QueueName } from '../../../../platform/messaging/queues'
import { createMockLogger } from '../../../setup/mockFactories'

// `var` so the declaration hoists into jest.mock's factory, which runs before
// any `let`/`const` in this module is initialised. Same pattern as the other
// Stellar suites.
// eslint-disable-next-line no-var
var operationCall: jest.Mock

jest.mock('@stellar/stellar-sdk', () => {
  operationCall = jest.fn()
  class MockServer {
    public operations() {
      return { operation: (id: string) => ({ call: () => operationCall(id) }) }
    }
  }
  return { Horizon: { Server: MockServer } }
})

const ACCOUNT_ID = 'GABROADACCOUNT'
const ISSUER = 'GAISSUER'
const TRANSACTION_ID = '9f8c2c1e-4b3a-4d5e-8f7a-1c2b3d4e5f60'
const TX_HASH = 'abc123hash'

/** The memo encoding the service decodes back into a transaction id. */
const memoFor = (uuid: string): string =>
  Buffer.from(uuid.replaceAll('-', ''), 'hex').toString('base64')

const buildPayment = (overrides: Record<string, unknown> = {}) => ({
  asset_code: 'USDC',
  asset_issuer: ISSUER,
  asset_type: 'credit_alphanum4',
  id: 'payment-1',
  paging_token: 'cursor-1',
  to: ACCOUNT_ID,
  transaction: jest.fn(async () => ({ id: TX_HASH, memo: memoFor(TRANSACTION_ID) })),
  transaction_hash: TX_HASH,
  type: 'payment',
  ...overrides,
})

const buildHarness = () => {
  const findUnique = jest.fn(async () => ({
    id: TRANSACTION_ID,
    refundOnChainId: null,
    status: TransactionStatus.AWAITING_PAYMENT,
  }) as unknown)
  const prismaProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      transaction: { findUnique },
    }) as unknown as PrismaClient),
  }
  const secretManager = {
    getSecret: jest.fn(async (name: string) =>
      name === 'STELLAR_ACCOUNT_ID' ? ACCOUNT_ID : 'https://horizon.example'),
    getSecrets: jest.fn(async () => ({
      HORIZON_URL: 'https://horizon.example',
      STELLAR_ACCOUNT_ID: ACCOUNT_ID,
    })),
  } as unknown as ISecretManager
  const enqueueQueue = jest.fn(async () => undefined)
  const refundOrphanPayment = jest.fn(async () => ({
    outcome: 'refunded' as const,
    refundTransactionId: 'refund-tx-1',
  }))
  const verifyNotification = jest.fn(async () => ({
    outcome: 'success' as const,
    queueMessage: { transactionId: TRANSACTION_ID },
  }))
  const verifierRegistry = {
    getVerifier: jest.fn(() => ({ verifyNotification })),
  } as unknown as IDepositVerifierRegistry
  const assetConfigService = {
    listEnabledAssets: jest.fn(async () => [
      { cryptoCurrency: CryptoCurrency.USDC, mintAddress: ISSUER },
    ]),
  } as unknown as CryptoAssetConfigService

  const service = new StellarReconciliationService(
    prismaProvider,
    secretManager,
    { enqueueQueue } as unknown as OutboxDispatcher,
    { refundOrphanPayment } as unknown as StellarOrphanRefundService,
    assetConfigService,
    verifierRegistry,
    createMockLogger(),
  )

  return { enqueueQueue, findUnique, refundOrphanPayment, service, verifyNotification }
}

/**
 * Characterization tests: this service had no coverage, and it decides whether
 * a Stellar payment that the listener missed gets credited, refunded as an
 * orphan, or left alone. Each case below pins an outcome that is either a
 * customer being paid or a customer's funds being returned, so these exist to
 * make a later refactor of the 587-line file provably behaviour-preserving.
 */
describe('StellarReconciliationService.reconcilePaymentById', () => {
  beforeEach(() => {
    operationCall.mockReset()
    operationCall.mockResolvedValue(buildPayment())
  })

  it('enqueues a verified payment against an awaiting transaction', async () => {
    const harness = buildHarness()

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toEqual({
      paymentId: TRANSACTION_ID,
      reason: undefined,
      refundTransactionId: undefined,
      result: 'enqueued',
      transactionId: TRANSACTION_ID,
    })
    expect(harness.enqueueQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      { transactionId: TRANSACTION_ID },
      'stellar.reconcile',
      { deliverNow: true },
    )
  })

  it('rejects an empty payment id before touching Horizon', async () => {
    const harness = buildHarness()

    const result = await harness.service.reconcilePaymentById('   ')

    expect(result).toEqual({ paymentId: '   ', result: 'invalid', transactionId: null })
    expect(operationCall).not.toHaveBeenCalled()
  })

  it.each([
    ['a payment to another account', { to: 'GSOMEONEELSE' }],
    ['a native-asset payment', { asset_code: undefined, asset_issuer: undefined, asset_type: 'native' }],
    ['an asset that is not enabled', { asset_issuer: 'GUNKNOWNISSUER' }],
  ])('treats %s as irrelevant and never enqueues', async (_label, overrides) => {
    const harness = buildHarness()
    operationCall.mockResolvedValue(buildPayment(overrides))

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result.result).toBe('irrelevant')
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('refunds a payment whose memo carries no transaction id', async () => {
    const harness = buildHarness()
    operationCall.mockResolvedValue(buildPayment({
      transaction: jest.fn(async () => ({ id: TX_HASH, memo: '' })),
    }))

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(harness.refundOrphanPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'missingMemo' }),
    )
    expect(result).toMatchObject({
      reason: 'missingMemo',
      refundTransactionId: 'refund-tx-1',
      result: 'invalid',
    })
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('halts rather than dropping a payment when the orphan refund fails', async () => {
    const harness = buildHarness()
    operationCall.mockResolvedValue(buildPayment({
      transaction: jest.fn(async () => ({ id: TX_HASH, memo: '' })),
    }))
    harness.refundOrphanPayment.mockResolvedValueOnce({
      outcome: 'failed',
      refundTransactionId: null,
    } as never)

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result.result).toBe('failed')
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('reports a memo that decodes to nothing usable as invalid', async () => {
    const harness = buildHarness()
    operationCall.mockResolvedValue(buildPayment({
      transaction: jest.fn(async () => ({ id: TX_HASH, memo: Buffer.from('short').toString('base64') })),
    }))

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ reason: 'invalidMemoFormat', result: 'invalid' })
  })

  it('reports a memo pointing at no local transaction as missing', async () => {
    const harness = buildHarness()
    harness.findUnique.mockResolvedValueOnce(null)

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ result: 'missing', transactionId: TRANSACTION_ID })
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('does not re-credit a transaction that already moved past awaiting payment', async () => {
    const harness = buildHarness()
    harness.findUnique.mockResolvedValueOnce({
      id: TRANSACTION_ID,
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
    } as never)

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ result: 'alreadyProcessed', transactionId: TRANSACTION_ID })
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('credits an expired transaction that has not been refunded', async () => {
    const harness = buildHarness()
    harness.findUnique.mockResolvedValueOnce({
      id: TRANSACTION_ID,
      refundOnChainId: null,
      status: TransactionStatus.PAYMENT_EXPIRED,
    } as never)

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ result: 'enqueued' })
    expect(harness.enqueueQueue).toHaveBeenCalledTimes(1)
  })

  it('never pays out an expired transaction that was already refunded', async () => {
    const harness = buildHarness()
    harness.findUnique.mockResolvedValueOnce({
      id: TRANSACTION_ID,
      refundOnChainId: 'refund-on-chain-1',
      status: TransactionStatus.PAYMENT_EXPIRED,
    } as never)

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    // Crediting here would be a payout on top of a completed refund.
    expect(result).toMatchObject({ result: 'alreadyProcessed' })
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('halts instead of enqueuing when on-chain verification rejects the payment', async () => {
    const harness = buildHarness()
    harness.verifyNotification.mockResolvedValueOnce({
      outcome: 'error',
      reason: 'amount_mismatch',
      status: 'failed',
    } as never)

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ result: 'failed', transactionId: TRANSACTION_ID })
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('halts when the enqueue itself fails, leaving the payment for a later run', async () => {
    const harness = buildHarness()
    harness.enqueueQueue.mockRejectedValueOnce(new Error('outbox down'))

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ result: 'failed', transactionId: TRANSACTION_ID })
  })

  it.each([
    ['a 404', 'notFound', () => ({ response: { status: 404 } })],
    ['a 400', 'invalid', () => ({ response: { status: 400 } })],
    ['an unreachable Horizon', 'failed', () => new Error('network')],
  ])('maps %s to %s', async (_label, expected, buildError) => {
    const harness = buildHarness()
    operationCall.mockRejectedValue(buildError())

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result.result).toBe(expected)
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('treats a non-payment operation as irrelevant', async () => {
    const harness = buildHarness()
    operationCall.mockResolvedValue({ id: 'op-1', paging_token: 'c', type: 'create_account' })

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result.result).toBe('irrelevant')
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })

  it('halts when the transaction record cannot be fetched from Horizon', async () => {
    const harness = buildHarness()
    operationCall.mockResolvedValue(buildPayment({
      transaction: jest.fn(async () => { throw new Error('horizon tx fetch failed') }),
    }))

    const result = await harness.service.reconcilePaymentById(TRANSACTION_ID)

    expect(result).toMatchObject({ result: 'failed' })
    expect(harness.enqueueQueue).not.toHaveBeenCalled()
  })
})
