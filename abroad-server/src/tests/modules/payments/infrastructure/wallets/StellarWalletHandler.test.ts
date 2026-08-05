import 'reflect-metadata'
import { CryptoCurrency } from '@prisma/client'

import type { ILockManager } from '../../../../../platform/cacheLock/ILockManager'
import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { StellarWalletHandler } from '../../../../../modules/payments/infrastructure/wallets/StellarWalletHandler'
import { createMockLogger } from '../../../../setup/mockFactories'

const fetchBaseFeeMock = jest.fn(async () => 100)
const feeStatsMock = jest.fn(async () => ({ max_fee: { p90: '1000' } }))
const builderOptions: Array<{ fee?: string }> = []
const loadAccountMock = jest.fn(async () => ({ accountId: 'source-account' }))
const submitTransactionMock = jest.fn()
const operationCallMock: jest.Mock<Promise<{ source_account?: string }>, []> = jest.fn(async () => ({
  source_account: 'source-account',
}))
const operationsMock = jest.fn(() => ({
  operation: () => ({
    call: operationCallMock,
  }),
}))
type MockTransactionRecord = { fee_charged?: string, id?: string, source_account?: string }
const existingTx: MockTransactionRecord = { id: 'existing-tx' }
const transactionLookupMock: jest.Mock<Promise<MockTransactionRecord>, []> = jest.fn(async () => existingTx)
const transactionsMock = jest.fn(() => ({
  transaction: () => ({
    call: transactionLookupMock,
  }),
}))
const builtTx = {
  hash: jest.fn(() => Buffer.from('abcd', 'hex')),
  sign: jest.fn(),
  toXDR: jest.fn(() => 'signed-envelope-xdr'),
}
const addMemoMock = jest.fn().mockReturnThis()
const addOperationMock = jest.fn().mockReturnThis()
const setTimeoutMock = jest.fn().mockReturnThis()
const buildMock = jest.fn(() => builtTx)

const mockKeypair = {
  publicKey: () => 'PUBLIC-KEY',
  sign: jest.fn(),
}
// eslint-disable-next-line no-var
var memoTextMock: jest.Mock

jest.mock('@stellar/stellar-sdk', () => {
  memoTextMock = jest.fn((m: string) => ({ memo: m }))
  class MockServer {
    feeStats = feeStatsMock

    fetchBaseFee = fetchBaseFeeMock

    loadAccount = loadAccountMock

    operations = operationsMock
    submitTransaction = submitTransactionMock
    transactions = transactionsMock

    public constructor(public readonly url: string) {}
  }

  class MockTransactionBuilder {
    addMemo = addMemoMock
    addOperation = addOperationMock
    build = buildMock
    setTimeout = setTimeoutMock
    public constructor(_account: unknown, options: { fee?: string }) {
      builderOptions.push(options)
    }
  }

  return {
    Asset: class Asset {
      public constructor(public readonly code: string, public readonly issuer: string) {}
    },
    Horizon: { Server: MockServer },
    Keypair: { fromSecret: jest.fn(() => mockKeypair) },
    Memo: { text: memoTextMock },
    Networks: { PUBLIC: 'PUBLIC' },
    Operation: { payment: (args: unknown) => args },
    Transaction: class {},
    TransactionBuilder: MockTransactionBuilder,
  }
})

describe('StellarWalletHandler', () => {
  const secretManager = {
    getSecret: jest.fn(),
  }
  const lockManager = {
    withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<string>) => fn()),
  }
  const logger = createMockLogger()
  const assetConfigService = { getActiveMint: jest.fn(async ({ cryptoCurrency }: { cryptoCurrency: CryptoCurrency }) => cryptoCurrency === CryptoCurrency.USDC ? ({ mintAddress: 'issuer' }) : null) }

  beforeEach(() => {
    jest.clearAllMocks()
    builtTx.hash.mockClear()
    builtTx.sign.mockClear()
    builtTx.toXDR.mockClear()
    buildMock.mockClear()
    addMemoMock.mockClear()
    addOperationMock.mockClear()
    setTimeoutMock.mockClear()
    memoTextMock.mockClear()
    fetchBaseFeeMock.mockClear()
    feeStatsMock.mockClear()
    feeStatsMock.mockResolvedValue({ max_fee: { p90: '1000' } })
    builderOptions.length = 0
    loadAccountMock.mockClear()
    operationCallMock.mockClear()
    transactionLookupMock.mockClear()
    operationsMock.mockClear()
    transactionsMock.mockClear()
    mockKeypair.sign.mockClear()
    ;(secretManager.getSecret as jest.Mock).mockResolvedValue('value')
    submitTransactionMock.mockResolvedValue({ hash: 'tx-hash' })
  })

  it('rejects unsupported currencies', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const result = await handler.send({
      address: 'dest',
      amount: 1,
      cryptoCurrency: 'UNSUPPORTED' as unknown as CryptoCurrency,
      memo: undefined,
    })

    expect(result.success).toBe(false)
    expect(submitTransactionMock).not.toHaveBeenCalled()
  })

  /*
   * `fetchBaseFee()` reports the ledger floor (100 stroops), not the going
   * rate. Bidding the floor under surge means the transaction is never
   * included and dies when its timebound lapses — Horizon answers 504 and it
   * reads as a network fault. Observed in production 2026-08-05 with ledger
   * capacity at 1.14 and a median competing bid near 144,000 stroops: two
   * consecutive customer deliveries failed against a completely healthy
   * network.
   */
  const sendOnce = async () => {
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://horizon.test')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('secret-key')
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    return handler.send({ address: 'DESTINATION', amount: 1, cryptoCurrency: CryptoCurrency.USDC })
  }

  it('bids the network rate rather than the ledger floor', async () => {
    feeStatsMock.mockResolvedValue({ max_fee: { p90: '144395' } })

    await sendOnce()

    expect(builderOptions.at(-1)?.fee).toBe('144395')
  })

  // Stellar charges the clearing price, not the bid, so a high bid is free in
  // the ordinary case — but an unbounded one would let a fee spike drain the
  // wallet's XLM one send at a time.
  it('caps the bid so a fee spike cannot drain the wallet', async () => {
    feeStatsMock.mockResolvedValue({ max_fee: { p90: '364757672' } })

    await sendOnce()

    expect(Number(builderOptions.at(-1)?.fee)).toBe(1_000_000)
  })

  it('never bids below the ledger base fee', async () => {
    feeStatsMock.mockResolvedValue({ max_fee: { p90: '10' } })
    fetchBaseFeeMock.mockResolvedValue(100)

    await sendOnce()

    expect(Number(builderOptions.at(-1)?.fee)).toBeGreaterThanOrEqual(100)
  })

  // Fee stats are advisory; losing them must not silently drop us back to a
  // floor bid, which is the exact failure this replaced.
  it('still bids above the floor when fee stats are unavailable', async () => {
    feeStatsMock.mockRejectedValue(new Error('horizon unavailable'))
    fetchBaseFeeMock.mockResolvedValue(100)

    await sendOnce()

    expect(Number(builderOptions.at(-1)?.fee)).toBeGreaterThan(100)
  })

  it('sends USDC payments and returns transaction id', async () => {
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://horizon.test')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('secret-key')

    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const result = await handler.send({
      address: 'DESTINATION',
      amount: 12.345678,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: 'hello world',
    })

    expect(lockManager.withLock).toHaveBeenCalled()
    expect(submitTransactionMock).toHaveBeenCalled()
    expect(result).toEqual({ success: true, transactionId: 'tx-hash' })
  })

  it('reads the confirmed fee charged by Horizon for historical reconciliation', async () => {
    transactionLookupMock.mockResolvedValueOnce({ fee_charged: '100', id: 'tx-hash' })
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)

    await expect(handler.getTransactionFee('tx-hash')).resolves.toEqual({
      fee: { amount: '0.0000100', currency: 'XLM' },
      outcome: 'found',
    })
  })

  it('returns a sanitized permanent failure while preserving the prepared hash', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const responseError = Object.assign(new Error('bad request'), {
      response: { data: { error: 'bad request' }, status: 400 },
    })
    submitTransactionMock.mockRejectedValueOnce(responseError)

    const result = await handler.send({
      address: 'DESTINATION',
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: 'memo',
    })

    expect(result).toEqual({
      code: 'permanent',
      reason: 'stellar_submission_rejected',
      reconciliationRequired: true,
      success: false,
      transactionId: 'abcd',
    })
  })

  it('returns a sanitized retriable failure when the provider gives no details', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    submitTransactionMock.mockRejectedValueOnce({})

    const result = await handler.send({
      address: 'DESTINATION',
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: 'memo',
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'stellar_submission_failed',
      reconciliationRequired: true,
      success: false,
      transactionId: 'abcd',
    })
  })

  it('persists the signed transaction identity before one durable submission', async () => {
    submitTransactionMock.mockResolvedValueOnce({ hash: 'abcd' })
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const persistPrepared = jest.fn(async (prepared) => {
      expect(submitTransactionMock).not.toHaveBeenCalled()
      expect(prepared).toEqual(expect.objectContaining({
        amount: '5.99',
        signedEnvelopeXdr: 'signed-envelope-xdr',
        transactionId: 'abcd',
      }))
    })

    const result = await handler.sendDurably({
      address: 'DESTINATION',
      amount: 5.99,
      cryptoCurrency: CryptoCurrency.USDC,
    }, persistPrepared)

    expect(persistPrepared).toHaveBeenCalledTimes(1)
    expect(submitTransactionMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ outcome: 'confirmed', transactionId: 'abcd' })
  })

  it('does not resubmit a durable transaction after an ambiguous response', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { response: { status: 504 } })
    const notFoundError = Object.assign(new Error('not found'), { response: { status: 404 } })
    submitTransactionMock.mockRejectedValueOnce(timeoutError)
    transactionLookupMock.mockRejectedValueOnce(notFoundError)
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)

    const result = await handler.sendDurably({
      address: 'DESTINATION',
      amount: 5.99,
      cryptoCurrency: CryptoCurrency.USDC,
    }, async () => undefined)

    expect(submitTransactionMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      outcome: 'ambiguous',
      reason: 'stellar_submission_timeout',
      transactionId: 'abcd',
    })
  })

  it('distinguishes confirmed, failed, absent, and unavailable hash reconciliation', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    transactionLookupMock
      .mockResolvedValueOnce({ id: 'confirmed', successful: true } as MockTransactionRecord & { successful: boolean })
      .mockResolvedValueOnce({ id: 'failed', successful: false } as MockTransactionRecord & { successful: boolean })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404 } }))
      .mockRejectedValueOnce(Object.assign(new Error('down'), { response: { status: 503 } }))

    await expect(handler.reconcileTransaction('confirmed')).resolves.toEqual({ outcome: 'confirmed', transactionId: 'confirmed' })
    await expect(handler.reconcileTransaction('failed')).resolves.toEqual({ outcome: 'failed', transactionId: 'failed' })
    await expect(handler.reconcileTransaction('absent')).resolves.toEqual({ outcome: 'absent' })
    await expect(handler.reconcileTransaction('unavailable')).resolves.toEqual({
      outcome: 'unavailable', reason: 'stellar_reconciliation_unavailable',
    })
  })

  it('rejects malformed Horizon transaction evidence', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    transactionLookupMock.mockResolvedValueOnce({ id: 'malformed' })

    await expect(handler.reconcileTransaction('malformed')).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'stellar_reconciliation_invalid_response',
    })
  })

  it('trims long memos and skips memo when absent', async () => {
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://horizon.test')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('secret-key')
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)

    const longMemo = 'x'.repeat(40)
    await handler.send({
      address: 'DESTINATION',
      amount: 5,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: longMemo,
    })

    const trimmedMemo = memoTextMock.mock.calls[0][0]
    expect(trimmedMemo.length).toBeLessThanOrEqual(28)
    expect(addMemoMock).toHaveBeenCalledTimes(1)

    addMemoMock.mockClear()
    memoTextMock.mockClear()
    await handler.send({
      address: 'DESTINATION',
      amount: 2,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: undefined,
    })
    expect(addMemoMock).not.toHaveBeenCalled()
  })

  it('returns existing transactions without resubmitting on timeout', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { response: { status: 504 } })
    submitTransactionMock.mockRejectedValueOnce(timeoutError)
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const server = new (jest.requireMock('@stellar/stellar-sdk').Horizon.Server)('https://horizon.test')

    const result = await (handler as unknown as { submitWithRetry: (srv: unknown, tx: typeof builtTx) => Promise<unknown> }).submitWithRetry(server, builtTx)

    expect(result).toEqual(existingTx)
    expect(submitTransactionMock).toHaveBeenCalledTimes(1)
    expect(transactionLookupMock).toHaveBeenCalled()
  })

  it('resubmits when timeout lookup yields no transaction', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { response: { status: 504 } })
    submitTransactionMock.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({ hash: 'retry-hash' })
    transactionLookupMock.mockResolvedValueOnce(undefined as unknown as MockTransactionRecord)
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const server = new (jest.requireMock('@stellar/stellar-sdk').Horizon.Server)('https://horizon.test')

    const result = await (handler as unknown as { submitWithRetry: (srv: unknown, tx: typeof builtTx) => Promise<unknown> }).submitWithRetry(server, builtTx)

    expect(result).toEqual({ hash: 'retry-hash' })
    expect(submitTransactionMock).toHaveBeenCalledTimes(2)
  })

  it('retries once on submission timeout and returns existing transaction', async () => {
    const timeoutError = Object.assign(new Error('timeout'), {
      response: { status: 504 },
    })
    submitTransactionMock.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({ hash: 'retry-hash' })
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const server = new (jest.requireMock('@stellar/stellar-sdk').Horizon.Server)('https://horizon.test')
    ;(server as unknown as { transactions: () => { transaction: () => { call: () => Promise<never> } } }).transactions = () => ({
      transaction: () => ({
        call: async () => {
          throw new Error('not found')
        },
      }),
    })

    const result = await (handler as unknown as { submitWithRetry: (srv: unknown, tx: typeof builtTx) => Promise<unknown> }).submitWithRetry(server, builtTx)

    expect(result).toEqual({ hash: 'retry-hash' })
    expect(submitTransactionMock).toHaveBeenCalledTimes(2)
  })

  it('detects timeouts by message and rethrows non-timeout failures', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    const server = new (jest.requireMock('@stellar/stellar-sdk').Horizon.Server)('https://horizon.test')

    submitTransactionMock.mockRejectedValueOnce(new Error('request timed out'))
    const retryResult = await (handler as unknown as { submitWithRetry: (srv: unknown, tx: typeof builtTx) => Promise<unknown> }).submitWithRetry(server, builtTx)
    expect(retryResult).toEqual(existingTx)

    submitTransactionMock.mockRejectedValueOnce(new Error('bad request'))
    await expect(
      (handler as unknown as { submitWithRetry: (srv: unknown, tx: typeof builtTx) => Promise<unknown> }).submitWithRetry(server, builtTx),
    ).rejects.toThrow('bad request')
  })

  it('resolves the source account address and falls back to legacy operation ids', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)

    transactionLookupMock.mockResolvedValueOnce({ source_account: 'source-account' })
    const address = await handler.getAddressFromTransaction({ onChainId: 'tx-1' })
    expect(address).toBe('source-account')
    expect(operationCallMock).not.toHaveBeenCalled()

    transactionLookupMock.mockResolvedValueOnce({})
    operationCallMock.mockResolvedValueOnce({ source_account: 'fallback-source' })
    const fallbackFromTx = await handler.getAddressFromTransaction({ onChainId: 'tx-2' })
    expect(fallbackFromTx).toBe('fallback-source')

    transactionLookupMock.mockRejectedValueOnce(new Error('not found'))
    operationCallMock.mockResolvedValueOnce({ source_account: 'legacy-source' })
    const legacy = await handler.getAddressFromTransaction({ onChainId: 'op-2' })
    expect(legacy).toBe('legacy-source')

    transactionLookupMock.mockRejectedValueOnce(new Error('not found'))
    operationCallMock.mockResolvedValueOnce({})
    const fallback = await handler.getAddressFromTransaction({ onChainId: 'op-3' })
    expect(fallback).toBe('')
  })

  it('throws when both transaction and operation lookups fail', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)

    operationCallMock.mockRejectedValueOnce(new Error('horizon down'))
    transactionLookupMock.mockRejectedValueOnce(new Error('horizon down'))
    await expect(handler.getAddressFromTransaction({ onChainId: 'op-4' })).rejects.toThrow(
      'Failed to fetch transaction with ID op-4',
    )
  })

  it('throws when no onChainId is provided', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, assetConfigService as never, lockManager as unknown as ILockManager, logger)
    await expect(handler.getAddressFromTransaction({ onChainId: undefined })).rejects.toThrow(
      'onChainId is required to get address from transaction',
    )
  })
})
