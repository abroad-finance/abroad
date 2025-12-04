import 'reflect-metadata'
import { CryptoCurrency } from '@prisma/client'

import type { ILockManager } from '../../interfaces/ILockManager'
import type { ISecretManager } from '../../interfaces/ISecretManager'

import { StellarWalletHandler } from '../../services/StellarWalletHandler'

const submitTransactionMock = jest.fn()
const existingTx = { id: 'existing-tx' }
const builtTx = {
  hash: jest.fn(() => Buffer.from('abcd', 'hex')),
  sign: jest.fn(),
}

const mockKeypair = {
  publicKey: () => 'PUBLIC-KEY',
  sign: jest.fn(),
}

jest.mock('@stellar/stellar-sdk', () => {
  class MockServer {
    fetchBaseFee = jest.fn(async () => 100)

    loadAccount = jest.fn(async () => ({ accountId: 'source-account' }))

    submitTransaction = submitTransactionMock
    public constructor(public readonly url: string) {}
    operations() {
      return {
        operation: () => ({
          call: async () => ({ source_account: 'source-account' }),
        }),
      }
    }

    transactions() {
      return {
        transaction: () => ({
          call: async () => existingTx,
        }),
      }
    }
  }

  class MockTransactionBuilder {
    addMemo = jest.fn().mockReturnThis()
    addOperation = jest.fn().mockReturnThis()
    build = jest.fn(() => builtTx)
    setTimeout = jest.fn().mockReturnThis()
    public constructor() {}
  }

  return {
    Asset: class Asset {
      public constructor(public readonly code: string, public readonly issuer: string) {}
    },
    Horizon: { Server: MockServer },
    Keypair: { fromSecret: jest.fn(() => mockKeypair) },
    Memo: { text: (m: string) => ({ memo: m }) },
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

  beforeEach(() => {
    jest.clearAllMocks()
    builtTx.hash.mockClear()
    builtTx.sign.mockClear()
    mockKeypair.sign.mockClear()
    ;(secretManager.getSecret as jest.Mock).mockResolvedValue('value')
    submitTransactionMock.mockResolvedValue({ hash: 'tx-hash' })
  })

  it('rejects unsupported currencies', async () => {
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager)
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

    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager)
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

  it('retries once on submission timeout and returns existing transaction', async () => {
    const timeoutError = Object.assign(new Error('timeout'), {
      response: { status: 504 },
    })
    submitTransactionMock.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({ hash: 'retry-hash' })
    const handler = new StellarWalletHandler(secretManager as unknown as ISecretManager, lockManager as unknown as ILockManager)
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
})
