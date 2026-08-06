import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { xdr } from '@stellar/stellar-sdk'
import axios from 'axios'

import { ConfidentialDepositVerifier } from '../../../../../modules/payments/infrastructure/wallets/ConfidentialDepositVerifier'
import { buildConfidentialTransfer, buildTransferEnvelope, testAccountAddress, testContractAddress } from './confidentialTestUtils'

// Spy rather than auto-mock: other modules in the import graph build axios
// instances at load time, and an auto-mocked `create()` returns undefined.
const post = jest.spyOn(axios, 'post')

const TRANSACTION_ID = '3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50'
const VIEWING_KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0'
const DECIMALS = 7
/** 12.3456789 USDC in the underlying token's minor units. */
const MINOR_UNITS = 123_456_789n

const contractAddress = testContractAddress()
const depositAccount = testAccountAddress()
const sender = testAccountAddress()

const transfer = buildConfidentialTransfer({
  amount: MINOR_UNITS,
  viewingKey: BigInt(`0x${VIEWING_KEY}`),
})

const envelopeFor = (overrides: Partial<Parameters<typeof buildTransferEnvelope>[0]> = {}) =>
  buildTransferEnvelope({
    contractAddress,
    recipient: depositAccount,
    reference: TRANSACTION_ID,
    sender,
    transfer,
    ...overrides,
  })

/** Mirrors the JSON-RPC shape the verifier reads, not the SDK's parsed wrapper. */
const setTransaction = (envelope: xdr.TransactionEnvelope, status = 'SUCCESS') => {
  post.mockResolvedValue({
    data: { result: { envelopeXdr: envelope.toXDR('base64'), status } },
  })
}

const buildVerifier = (overrides: {
  asset?: null | { contractAddress: string, decimals: number, depositContractAddress: string }
  currency?: CryptoCurrency
  duplicateOnChain?: boolean
  network?: BlockchainNetwork
  status?: TransactionStatus
  viewingKey?: string
} = {}) => {
  const prisma = {
    transaction: {
      findFirst: jest.fn(async () => (
        overrides.duplicateOnChain ? { id: 'another-transaction' } : null
      )),
      findUnique: jest.fn(async () => ({
        id: TRANSACTION_ID,
        quote: {
          cryptoCurrency: overrides.currency ?? CryptoCurrency.USDC,
          network: overrides.network ?? BlockchainNetwork.STELLAR,
        },
        status: overrides.status ?? TransactionStatus.AWAITING_PAYMENT,
      })),
    },
  }
  const secretManager = {
    getSecret: jest.fn(async () => 'https://soroban.test'),
    getSecrets: jest.fn(async () => ({
      SOROBAN_RPC_URL: 'https://soroban.test',
      STELLAR_CONFIDENTIAL_ACCOUNT_ID: depositAccount,
      STELLAR_CONFIDENTIAL_VIEWING_KEY: overrides.viewingKey ?? VIEWING_KEY,
    })),
  }
  const assetConfigService = {
    getActiveConfidentialAsset: jest.fn(async () => (
      overrides.asset === undefined
        ? { contractAddress: 'CTOKEN', decimals: DECIMALS, depositContractAddress: contractAddress }
        : overrides.asset
    )),
  }
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const verifier = new ConfidentialDepositVerifier(
    { getClient: jest.fn(async () => prisma) } as never,
    secretManager as never,
    assetConfigService as never,
    logger as never,
  )

  return { logger, prisma, verifier }
}

beforeEach(() => {
  setTransaction(envelopeFor())
})

describe('ConfidentialDepositVerifier', () => {
  it('accepts a transfer whose disclosure matches the on-chain commitment', async () => {
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'ok',
      queueMessage: {
        addressFrom: sender,
        amount: 12.3456789,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: 'tx-hash',
        transactionId: TRANSACTION_ID,
      },
    })
  })

  it('reads the Abroad reference out of the memo for the listener', async () => {
    const { verifier } = buildVerifier()

    await expect(verifier.resolveTransactionId('tx-hash')).resolves.toBe(TRANSACTION_ID)
  })

  it('returns no reference when the transaction is not a confidential deposit', async () => {
    setTransaction(envelopeFor({ functionName: 'merge' }))
    const { verifier } = buildVerifier()

    await expect(verifier.resolveTransactionId('tx-hash')).resolves.toBeNull()
  })

  it('rejects an unknown transaction', async () => {
    const { prisma, verifier } = buildVerifier()
    prisma.transaction.findUnique.mockResolvedValueOnce(null as never)

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Transaction not found',
      status: 404,
    })
  })

  it('rejects a transaction that is no longer awaiting payment', async () => {
    const { verifier } = buildVerifier({ status: TransactionStatus.PAYMENT_COMPLETED })

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Transaction is not awaiting payment',
      status: 400,
    })
  })

  it('rejects a quote priced for another network', async () => {
    const { verifier } = buildVerifier({ network: BlockchainNetwork.SOLANA })
    const outcome = await verifier.verifyNotification('tx-hash', TRANSACTION_ID)

    expect(outcome).toMatchObject({ outcome: 'error', status: 400 })
  })

  it('rejects an on-chain id already linked to another transaction', async () => {
    const { verifier } = buildVerifier({ duplicateOnChain: true })

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'On-chain transaction already linked to another transaction',
      status: 400,
    })
  })

  it('rejects a currency with no enabled confidential deployment', async () => {
    const { verifier } = buildVerifier({ asset: null })

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Unsupported currency for confidential Stellar payments',
      status: 400,
    })
  })

  it('rejects a malformed viewing key rather than guessing at one', async () => {
    const { verifier } = buildVerifier({ viewingKey: 'not-a-key' })

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Confidential deposit configuration is invalid',
      status: 400,
    })
  })

  it('rejects a deposit through a different wrapper contract', async () => {
    setTransaction(envelopeFor({ contractAddress: testContractAddress(2) }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Deposit does not target the configured wrapper contract',
      status: 400,
    })
  })

  it('rejects a transfer to a different recipient', async () => {
    setTransaction(envelopeFor({ recipient: testAccountAddress() }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Transfer does not target the configured wallet',
      status: 400,
    })
  })

  it('rejects a reference naming a different transaction', async () => {
    setTransaction(envelopeFor({ reference: '11111111-2222-3333-4444-555555555555' }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Deposit reference does not match transaction',
      status: 400,
    })
  })

  it('rejects a transfer sent straight to the token, bypassing the wrapper', async () => {
    setTransaction(envelopeFor({ functionName: 'confidential_transfer', reference: null }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Transaction is not a confidential deposit',
      status: 400,
    })
  })

  it('rejects a disclosure that does not open the on-chain commitment', async () => {
    // Same ciphertext, a commitment belonging to a different amount: the payer
    // claims one amount on the wire and moved another on chain.
    const mismatched = buildConfidentialTransfer({
      amount: MINOR_UNITS * 2n,
      viewingKey: BigInt(`0x${VIEWING_KEY}`),
    })
    setTransaction(envelopeFor({
      transfer: { ...transfer, transferCommitment: mismatched.transferCommitment },
    }))
    const { logger, verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Disclosed amount does not match the on-chain commitment',
      status: 400,
    })
    expect(logger.warn).toHaveBeenCalledWith('[ConfidentialDepositVerifier] Rejected confidential deposit disclosure', {
      failure: 'commitment_mismatch',
      transactionId: TRANSACTION_ID,
    })
  })

  it('rejects a transfer encrypted to somebody else', async () => {
    setTransaction(envelopeFor({
      transfer: buildConfidentialTransfer({ amount: MINOR_UNITS, viewingKey: 0xabcdefn }),
    }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toMatchObject({
      outcome: 'error',
      reason: 'Disclosed amount does not match the on-chain commitment',
    })
  })

  it('rejects an amount too large to carry on the deposit queue', async () => {
    setTransaction(envelopeFor({
      transfer: buildConfidentialTransfer({
        amount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        viewingKey: BigInt(`0x${VIEWING_KEY}`),
      }),
    }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Disclosed amount is out of the representable range',
      status: 400,
    })
  })

  it('rejects a transaction that failed on-chain', async () => {
    setTransaction(envelopeFor(), 'FAILED')
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Transaction failed on-chain',
      status: 400,
    })
  })

  it('reports a transaction the RPC no longer retains as not found', async () => {
    setTransaction(envelopeFor(), 'NOT_FOUND')
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Transaction not found on Soroban RPC',
      status: 404,
    })
  })

  it('does not advance when the RPC call itself fails', async () => {
    post.mockRejectedValue(new Error('connection reset'))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toEqual({
      outcome: 'error',
      reason: 'Failed to fetch transaction from Soroban RPC',
      status: 400,
    })
  })

  it('converts whole-unit tokens without a decimal point', async () => {
    setTransaction(envelopeFor({
      transfer: buildConfidentialTransfer({ amount: 5n, viewingKey: BigInt(`0x${VIEWING_KEY}`) }),
    }))
    const { verifier } = buildVerifier()

    await expect(verifier.verifyNotification('tx-hash', TRANSACTION_ID)).resolves.toMatchObject({
      queueMessage: expect.objectContaining({ amount: 0.0000005 }),
    })
  })

  it('never logs the disclosed amount, the memo or an address', async () => {
    const { logger, verifier } = buildVerifier()
    await verifier.verifyNotification('tx-hash', TRANSACTION_ID)

    const emitted = JSON.stringify([
      logger.error.mock.calls,
      logger.info.mock.calls,
      logger.warn.mock.calls,
    ])
    expect(emitted).not.toContain(depositAccount)
    expect(emitted).not.toContain(sender)
    expect(emitted).not.toContain(VIEWING_KEY)
    expect(emitted).not.toContain('12.3456789')
    expect(emitted).not.toContain(TRANSACTION_ID.replace(/-/g, ''))
  })
})
