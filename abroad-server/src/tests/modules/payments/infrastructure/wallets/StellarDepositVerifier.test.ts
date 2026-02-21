import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'

import { StellarDepositVerifier } from '../../../../../modules/payments/infrastructure/wallets/StellarDepositVerifier'
import { Secrets } from '../../../../../platform/secrets/ISecretManager'

type FakeOperationRecord = {
  amount: string
  asset_code?: string
  asset_issuer?: string
  asset_type: string
  from: string
  id: string
  to: string
  transaction_hash?: string
  type: string
}

type FakeOperationsPage = { records: FakeOperationRecord[] }

type FakeServer = {
  operations: () => { forTransaction: (id: string) => { call: () => Promise<FakeOperationsPage> } }
  transactions: () => { transaction: (id: string) => { call: () => Promise<FakeTransactionRecord> } }
}

type FakeTransactionRecord = {
  id?: string
  memo: null | string
}

let currentServer: FakeServer

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(() => currentServer),
  },
}))

const accountId = 'account-1'
const usdcIssuer = 'issuer-1'
const horizonUrl = 'https://horizon.test'

const buildTransactionRecord = (overrides: Partial<FakeTransactionRecord> = {}): FakeTransactionRecord => ({
  id: 'tx-hash',
  memo: Buffer.from('00000000000000000000000000000000', 'hex').toString('base64'),
  ...overrides,
})

const buildPayment = (overrides: Partial<FakeOperationRecord> = {}): FakeOperationRecord => ({
  amount: '10',
  asset_code: 'USDC',
  asset_issuer: usdcIssuer,
  asset_type: 'credit_alphanum4',
  from: 'sender',
  id: 'op-1',
  to: accountId,
  transaction_hash: 'tx-hash',
  type: 'payment',
  ...overrides,
})

const setServer = (transactionRecord: FakeTransactionRecord, records: FakeOperationRecord[]) => {
  currentServer = {
    operations: () => ({
      forTransaction: () => ({
        call: async () => ({ records }),
      }),
    }),
    transactions: () => ({
      transaction: () => ({
        call: async () => transactionRecord,
      }),
    }),
  }
}

const buildVerifier = (transactionOverrides?: Partial<{ currency: CryptoCurrency, network: BlockchainNetwork, status: TransactionStatus }>) => {
  const prisma = {
    transaction: {
      findUnique: jest.fn(async () => ({
        id: 'txn-1',
        quote: {
          cryptoCurrency: transactionOverrides?.currency ?? CryptoCurrency.USDC,
          network: transactionOverrides?.network ?? BlockchainNetwork.STELLAR,
        },
        refundOnChainId: null,
        status: transactionOverrides?.status ?? TransactionStatus.AWAITING_PAYMENT,
      })),
    },
  }
  const dbProvider = {
    getClient: jest.fn(async () => prisma),
  }
  const secretManager = {
    getSecret: jest.fn(async (key: string) => {
      switch (key) {
        case Secrets.STELLAR_ACCOUNT_ID:
          return accountId
        case Secrets.STELLAR_HORIZON_URL:
          return horizonUrl
        default:
          return ''
      }
    }),
  }
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const assetConfigService = { getActiveMint: jest.fn(async ({ cryptoCurrency }: { cryptoCurrency: CryptoCurrency }) => cryptoCurrency === CryptoCurrency.USDC ? ({ mintAddress: usdcIssuer }) : null) }
  const verifier = new StellarDepositVerifier(dbProvider as never, secretManager as never, assetConfigService as never, logger as never)
  return { dbProvider, logger, prisma, secretManager, verifier }
}

describe('StellarDepositVerifier', () => {
  it('rejects invalid or missing transactions early', async () => {
    const { prisma, verifier } = buildVerifier()
    prisma.transaction.findUnique.mockResolvedValueOnce(null as never)
    setServer(buildTransactionRecord(), [buildPayment()])

    const missing = await verifier.verifyNotification('on-chain', 'txn-missing')
    expect(missing).toEqual({ outcome: 'error', reason: 'Transaction not found', status: 404 })

    const { verifier: statusVerifier } = buildVerifier({ status: TransactionStatus.PAYMENT_COMPLETED })
    setServer(buildTransactionRecord(), [buildPayment()])
    const notAwaiting = await statusVerifier.verifyNotification('on-chain', 'txn-1')
    if (notAwaiting.outcome === 'error') {
      expect(notAwaiting.status).toBe(400)
    }

    const { verifier: networkVerifier } = buildVerifier({ network: BlockchainNetwork.SOLANA })
    setServer(buildTransactionRecord(), [buildPayment()])
    const wrongNetwork = await networkVerifier.verifyNotification('on-chain', 'txn-1')
    if (wrongNetwork.outcome === 'error') {
      expect(wrongNetwork.reason).toContain('Transaction is not set for Stellar')
    }

    const { verifier: currencyVerifier } = buildVerifier({ currency: 'USDT' as CryptoCurrency })
    setServer(buildTransactionRecord(), [buildPayment()])
    const wrongCurrency = await currencyVerifier.verifyNotification('on-chain', 'txn-1')
    if (wrongCurrency.outcome === 'error') {
      expect(wrongCurrency.reason).toContain('Unsupported currency')
    }
  })

  it('handles horizon failures and unsupported operations', async () => {
    const { verifier } = buildVerifier()
    const notFoundError = Object.assign(new Error('missing'), { response: { status: 404 } })
    currentServer = {
      operations: () => ({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => {
            throw notFoundError
          },
        }),
      }),
    }
    const notFound = await verifier.verifyNotification('on-chain', 'txn-1')
    if (notFound.outcome === 'error') {
      expect(notFound.status).toBe(404)
    }

    setServer(buildTransactionRecord(), [{ ...buildPayment(), type: 'create_account' }])
    const unsupported = await verifier.verifyNotification('op-unsupported', 'txn-1')
    if (unsupported.outcome === 'error') {
      expect(unsupported.reason).toBe('Transaction does not include a payment operation')
    }
  })

  it('handles transaction lookup errors with non-standard shapes', async () => {
    const { verifier } = buildVerifier()
    currentServer = {
      operations: () => ({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => {
            throw 'invalid'
          },
        }),
      }),
    }

    const stringError = await verifier.verifyNotification('on-chain', 'txn-1')
    if (stringError.outcome === 'error') {
      expect(stringError.reason).toBe('Failed to fetch transaction')
      expect(stringError.status).toBe(400)
    }

    currentServer = {
      operations: () => ({
        forTransaction: () => ({
          call: async () => ({ records: [] }),
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => {
            throw { response: { status: 'bad' } }
          },
        }),
      }),
    }

    const invalidStatus = await verifier.verifyNotification('on-chain', 'txn-1')
    if (invalidStatus.outcome === 'error') {
      expect(invalidStatus.reason).toBe('Failed to fetch transaction')
      expect(invalidStatus.status).toBe(400)
    }
  })

  it('returns operation lookup errors with mapped status', async () => {
    const { verifier } = buildVerifier()
    const operationsError = Object.assign(new Error('ops down'), { status: 500 })
    currentServer = {
      operations: () => ({
        forTransaction: () => ({
          call: async () => {
            throw operationsError
          },
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => buildTransactionRecord(),
        }),
      }),
    }

    const result = await verifier.verifyNotification('on-chain', 'txn-1')

    if (result.outcome === 'error') {
      expect(result.reason).toContain('ops down')
      expect(result.status).toBe(400)
    }

    const notFoundError = Object.assign(new Error('ops missing'), { response: { status: 404 } })
    currentServer = {
      operations: () => ({
        forTransaction: () => ({
          call: async () => {
            throw notFoundError
          },
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => buildTransactionRecord(),
        }),
      }),
    }

    const notFound = await verifier.verifyNotification('on-chain', 'txn-1')
    if (notFound.outcome === 'error') {
      expect(notFound.reason).toContain('ops missing')
      expect(notFound.status).toBe(404)
    }

    currentServer = {
      operations: () => ({
        forTransaction: () => ({
          call: async () => {
            throw 'ops down'
          },
        }),
      }),
      transactions: () => ({
        transaction: () => ({
          call: async () => buildTransactionRecord(),
        }),
      }),
    }

    const nonError = await verifier.verifyNotification('on-chain', 'txn-1')
    if (nonError.outcome === 'error') {
      expect(nonError.reason).toBe('Failed to fetch transaction operations')
      expect(nonError.status).toBe(400)
    }
  })

  it('validates payment destination and memo contents', async () => {
    const { verifier } = buildVerifier()
    const wrongTargetPayment = buildPayment({ to: 'other-account' })
    setServer(buildTransactionRecord(), [wrongTargetPayment])
    const wrongTarget = await verifier.verifyNotification('op-2', 'txn-1')
    if (wrongTarget.outcome === 'error') {
      expect(wrongTarget.reason).toContain('does not target')
    }

    setServer(buildTransactionRecord({ memo: null }), [buildPayment()])
    const missingMemo = await verifier.verifyNotification('op-3', 'txn-1')
    if (missingMemo.outcome === 'error') {
      expect(missingMemo.reason).toBe('Payment is missing memo')
    }
  })

  it('rejects memo mismatches', async () => {
    const { verifier } = buildVerifier()
    setServer(buildTransactionRecord(), [buildPayment()])

    const result = await verifier.verifyNotification('tx-hash', '11111111-1111-1111-1111-111111111111')

    if (result.outcome === 'error') {
      expect(result.reason).toBe('Payment memo does not match transaction')
    }
  })

  it('returns queue payload when verification succeeds', async () => {
    const { verifier } = buildVerifier()
    const memoUuid = '00000000-0000-0000-0000-000000000123'
    const memo = Buffer.from(memoUuid.replace(/-/g, ''), 'hex').toString('base64')
    setServer(buildTransactionRecord({ memo }), [buildPayment({ id: 'payment-1' })])

    const result = await verifier.verifyNotification('tx-hash', memoUuid)

    expect(result).toEqual({
      outcome: 'ok',
      queueMessage: {
        addressFrom: 'sender',
        amount: 10,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'tx-hash',
        transactionId: memoUuid,
      },
    })
  })
})
