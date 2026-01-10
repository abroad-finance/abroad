import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'

import { StellarDepositVerifier } from '../../../../../modules/payments/infrastructure/wallets/StellarDepositVerifier'
import { Secrets } from '../../../../../platform/secrets/ISecretManager'

type FakePaymentRecord = {
  amount: string
  asset_code?: string
  asset_issuer?: string
  asset_type: string
  from: string
  id: string
  paging_token?: string
  to: string
  transaction: jest.Mock<Promise<{ memo: null | string }>>
  type: string
}

let currentServer: { operations: () => { operation: (id: string) => { call: () => Promise<FakePaymentRecord> } } }

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(() => currentServer),
  },
}))

const accountId = 'account-1'
const usdcIssuer = 'issuer-1'
const horizonUrl = 'https://horizon.test'

const buildPayment = (overrides: Partial<FakePaymentRecord> = {}): FakePaymentRecord => ({
  amount: '10',
  asset_code: 'USDC',
  asset_issuer: usdcIssuer,
  asset_type: 'credit_alphanum4',
  from: 'sender',
  id: 'op-1',
  paging_token: 'cursor-1',
  to: accountId,
  transaction: jest.fn(async () => ({ memo: Buffer.from('00000000000000000000000000000000').toString('base64') })),
  type: 'payment',
  ...overrides,
})

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
        case Secrets.STELLAR_USDC_ISSUER:
          return usdcIssuer
        default:
          return ''
      }
    }),
  }
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const verifier = new StellarDepositVerifier(dbProvider as never, secretManager as never, logger as never)
  return { dbProvider, logger, prisma, secretManager, verifier }
}

describe('StellarDepositVerifier', () => {
  it('rejects invalid or missing transactions early', async () => {
    const { prisma, verifier } = buildVerifier()
    prisma.transaction.findUnique.mockResolvedValueOnce(null as never)
    currentServer = { operations: () => ({ operation: () => ({ call: async () => buildPayment() }) }) }

    const missing = await verifier.verifyNotification('on-chain', 'txn-missing')
    expect(missing).toEqual({ outcome: 'error', reason: 'Transaction not found', status: 404 })

    const { verifier: statusVerifier } = buildVerifier({ status: TransactionStatus.PAYMENT_COMPLETED })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => buildPayment() }) }) }
    const notAwaiting = await statusVerifier.verifyNotification('on-chain', 'txn-1')
    if (notAwaiting.outcome === 'error') {
      expect(notAwaiting.status).toBe(400)
    }

    const { verifier: networkVerifier } = buildVerifier({ network: BlockchainNetwork.SOLANA })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => buildPayment() }) }) }
    const wrongNetwork = await networkVerifier.verifyNotification('on-chain', 'txn-1')
    if (wrongNetwork.outcome === 'error') {
      expect(wrongNetwork.reason).toContain('Transaction is not set for Stellar')
    }

    const { verifier: currencyVerifier } = buildVerifier({ currency: 'USDT' as CryptoCurrency })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => buildPayment() }) }) }
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
        operation: () => ({
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

    const unsupportedPayment = buildPayment({ type: 'create_account' })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => unsupportedPayment }) }) }
    const unsupported = await verifier.verifyNotification('op-unsupported', 'txn-1')
    if (unsupported.outcome === 'error') {
      expect(unsupported.reason).toBe('Operation is not a payment')
    }
  })

  it('validates payment destination and memo contents', async () => {
    const { verifier } = buildVerifier()
    const wrongTargetPayment = buildPayment({ to: 'other-account' })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => wrongTargetPayment }) }) }
    const wrongTarget = await verifier.verifyNotification('op-2', 'txn-1')
    if (wrongTarget.outcome === 'error') {
      expect(wrongTarget.reason).toContain('does not target')
    }

    const missingMemoPayment = buildPayment({ transaction: jest.fn(async () => ({ memo: null })) })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => missingMemoPayment }) }) }
    const missingMemo = await verifier.verifyNotification('op-3', 'txn-1')
    if (missingMemo.outcome === 'error') {
      expect(missingMemo.reason).toBe('Payment is missing memo')
    }
  })

  it('returns queue payload when verification succeeds', async () => {
    const { verifier } = buildVerifier()
    const memoUuid = '00000000-0000-0000-0000-000000000123'
    const memo = Buffer.from(memoUuid.replace(/-/g, ''), 'hex').toString('base64')
    const payment = buildPayment({
      id: 'payment-1',
      transaction: jest.fn(async () => ({ memo })),
    })
    currentServer = { operations: () => ({ operation: () => ({ call: async () => payment }) }) }

    const result = await verifier.verifyNotification('payment-1', 'txn-1')

    expect(result).toEqual({
      outcome: 'ok',
      queueMessage: {
        addressFrom: payment.from,
        amount: Number(payment.amount),
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: payment.id,
        transactionId: memoUuid,
      },
    })
  })
})
