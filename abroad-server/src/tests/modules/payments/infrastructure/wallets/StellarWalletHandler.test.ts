import 'reflect-metadata'
import { CryptoCurrency } from '@prisma/client'

import type { ILockManager } from '../../../../../platform/cacheLock/ILockManager'
import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { StellarWalletHandler } from '../../../../../modules/payments/infrastructure/wallets/StellarWalletHandler'
import { createMockLogger } from '../../../../setup/mockFactories'

const fetchBaseFeeMock = jest.fn(async () => 100)
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
type MockTransactionRecord = { id?: string, source_account?: string }
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
    public constructor() {}
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

  beforeEach(() => {
    jest.clearAllMocks()
    builtTx.hash.mockClear()
    builtTx.sign.mockClear()
    buildMock.mockClear()
    addMemoMock.mockClear()
    addOperationMock.mockClear()
    setTimeoutMock.mockClear()
    memoTextMock.mockClear()
    fetchBaseFeeMock.mockClear()
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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
    const result = await handler.send({
      address: 'dest',
      amount: 1,
      cryptoCurrency: 'UNSUPPORTED' as unknown as CryptoCurrency,
      memo: undefined,
    })

    expect(result.success).toBe(false)
    expect(submitTransactionMock).not.toHaveBeenCalled()
  })

  it('sends USDC payments and returns transaction id', async () => {
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://horizon.test')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('secret-key')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('issuer')

    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
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

  it('uses response data when send fails', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
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
      code: 'retriable',
      reason: JSON.stringify({ error: 'bad request' }),
      success: false,
    })
  })

  it('uses unknown reason when errors have no details', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
    submitTransactionMock.mockRejectedValueOnce({})

    const result = await handler.send({
      address: 'DESTINATION',
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
      memo: 'memo',
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'unknown',
      success: false,
    })
  })

  it('trims long memos and skips memo when absent', async () => {
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('https://horizon.test')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('secret-key')
    ;(secretManager.getSecret as jest.Mock).mockResolvedValueOnce('issuer')
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)

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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)

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
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)

    operationCallMock.mockRejectedValueOnce(new Error('horizon down'))
    transactionLookupMock.mockRejectedValueOnce(new Error('horizon down'))
    await expect(handler.getAddressFromTransaction({ onChainId: 'op-4' })).rejects.toThrow(
      'Failed to fetch transaction with ID op-4',
    )
  })

  it('throws when no onChainId is provided', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager, logger)
    await expect(handler.getAddressFromTransaction({ onChainId: undefined })).rejects.toThrow(
      'onChainId is required to get address from transaction',
    )
  })
})
