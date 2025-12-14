import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, type ParsedInstruction, type ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'

import type { ILogger } from '../../../../../core/logging/types'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { SolanaPaymentVerifier } from '../../../../../modules/payments/infrastructure/wallets/SolanaPaymentVerifier'
import { type ISecretManager } from '../../../../../platform/secrets/ISecretManager'

const buildVerifier = () => {
  const secretManager: ISecretManager = {
    getSecret: jest.fn(),
    getSecrets: jest.fn(),
  }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({} as unknown as import('@prisma/client').PrismaClient)),
  }
  const logger: ILogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

  return { logger, secretManager, verifier: new SolanaPaymentVerifier(secretManager, dbProvider, logger) }
}

const buildTransferInstruction = (
  destination: string,
  mint: string,
  source: string,
  amount: string,
  decimals: number,
  programId: PublicKey = TOKEN_PROGRAM_ID,
): ParsedInstruction => ({
  parsed: {
    info: {
      destination,
      mint,
      source,
      tokenAmount: { amount, decimals },
    },
    type: 'transferChecked',
  },
  program: 'spl-token',
  programId,
} as ParsedInstruction)

describe('SolanaPaymentVerifier helpers', () => {
  it('parses token amounts through ordered fallbacks', () => {
    const { verifier } = buildVerifier()
    const parser = verifier as unknown as {
      parseTokenAmount: (amount: { amount: string, decimals: number, uiAmount: null | number, uiAmountString?: string }) => number
    }

    expect(parser.parseTokenAmount({ amount: '1', decimals: 2, uiAmount: null, uiAmountString: '10.5' })).toBeCloseTo(10.5)
    expect(parser.parseTokenAmount({ amount: '30', decimals: 1, uiAmount: 1.5, uiAmountString: 'nan' })).toBeCloseTo(1.5)
    expect(parser.parseTokenAmount({ amount: '500', decimals: 2, uiAmount: 0.75 })).toBeCloseTo(0.75)
    expect(parser.parseTokenAmount({ amount: '2000', decimals: 3, uiAmount: Number.NaN })).toBeCloseTo(2)
    expect(parser.parseTokenAmount({ amount: 'not-a-number', decimals: 6, uiAmount: null })).toBe(0)
  })

  it('throws when Solana configuration secrets are invalid', async () => {
    const { logger, secretManager, verifier } = buildVerifier()
    secretManager.getSecret = jest.fn(async () => 'invalid-key')

    await expect(verifier.buildPaymentContext()).rejects.toThrow('Solana configuration is invalid')
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Invalid Solana configuration',
      { depositWalletAddress: 'invalid-key', usdcMintAddress: 'invalid-key' },
    )
    expect(logger.warn).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Invalid public key string provided',
      expect.objectContaining({ key: 'invalid-key' }),
    )
  })

  it('validates Solana transactions and rejects unsupported scenarios', () => {
    const { verifier } = buildVerifier()
    expect(verifier.validateTransaction({
      quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.SOLANA },
      status: TransactionStatus.PAYMENT_COMPLETED,
    })).toBe('Transaction is not awaiting payment')

    expect(verifier.validateTransaction({
      quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.STELLAR },
      status: TransactionStatus.AWAITING_PAYMENT,
    })).toBe('Transaction is not set for Solana')

    expect(verifier.validateTransaction({
      quote: { cryptoCurrency: 'BTC' as CryptoCurrency, network: BlockchainNetwork.SOLANA },
      status: TransactionStatus.AWAITING_PAYMENT,
    })).toBe('Unsupported currency for Solana payments')

    expect(verifier.validateTransaction({
      quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.SOLANA },
      status: TransactionStatus.AWAITING_PAYMENT,
    })).toBeUndefined()
  })

  it('returns null for invalid public keys and logs the failure', () => {
    const { logger, verifier } = buildVerifier()
    expect(verifier.safePublicKey(null)).toBeNull()

    const badKey = 'not-a-public-key'
    expect(verifier.safePublicKey(badKey)).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Invalid public key string provided',
      expect.objectContaining({ key: badKey }),
    )

    const validKey = new PublicKey('11111111111111111111111111111111').toBase58()
    expect(verifier.safePublicKey(validKey)?.toBase58()).toBe(validKey)
  })

  it('maps Solana RPC failures to client-friendly errors', async () => {
    const { logger, verifier } = buildVerifier()

    const prismaClient = {
      transaction: {
        findUnique: jest.fn(async () => ({
          id: 'txn-1',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.SOLANA },
          status: TransactionStatus.AWAITING_PAYMENT,
        })),
      },
    } as unknown as import('@prisma/client').PrismaClient

    jest.spyOn(verifier, 'getPrismaClient').mockResolvedValue(prismaClient)
    jest.spyOn(verifier, 'ensureUniqueOnChainId').mockResolvedValue(undefined)
    jest.spyOn(verifier, 'buildPaymentContext').mockResolvedValue({
      connection: {} as Connection,
      tokenAccounts: [],
      usdcMint: TOKEN_PROGRAM_ID,
    })
    const fetchMock = jest.spyOn(verifier, 'fetchOnChainTransaction')
    fetchMock.mockRejectedValueOnce(new Error('Transaction failed on-chain'))

    const result = await verifier.verifyNotification('on-chain-sig', 'txn-1')
    fetchMock.mockRejectedValueOnce('non-error rejection' as unknown as Error)
    const fallbackReason = await verifier.verifyNotification('on-chain-sig-2', 'txn-1')

    expect(result).toEqual({ outcome: 'error', reason: 'Transaction failed on-chain', status: 400 })
    expect(fallbackReason).toEqual({ outcome: 'error', reason: 'Failed to fetch transaction from Solana', status: 400 })
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentVerifier] Failed to fetch transaction from Solana',
      expect.any(Error),
    )
  })

  it('walks parsed instructions to find the first matching USDC transfer', () => {
    const { verifier } = buildVerifier()
    const wallet = new PublicKey('5enWnVoUGq1i7P2TLXeC1xVq5YGWHzKWTS2KkPK7x9rP')
    const allowedMint = new PublicKey('So11111111111111111111111111111111111111112')
    const disallowedMint = new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')
    const missingTokenAmount = {
      parsed: {
        info: {
          destination: wallet.toBase58(),
          mint: allowedMint.toBase58(),
          source: 'missing-token-amount',
        },
        type: 'transferChecked',
      },
      program: 'spl-token',
      programId: TOKEN_PROGRAM_ID,
    } as ParsedInstruction
    const malformedTokenAmount = {
      parsed: {
        info: {
          destination: wallet.toBase58(),
          mint: allowedMint.toBase58(),
          source: 'malformed-token-amount',
          tokenAmount: { amount: 123, decimals: 'not-a-number' },
        },
        type: 'transferChecked',
      },
      program: 'spl-token',
      programId: TOKEN_PROGRAM_ID,
    } as ParsedInstruction

    const instructions: Array<unknown> = [
      { parsed: { note: 'missing program id' } },
      { parsed: { type: 'transferChecked' }, program: 'system', programId: new PublicKey('11111111111111111111111111111111') },
      buildTransferInstruction(
        new PublicKey(TOKEN_2022_PROGRAM_ID).toBase58(),
        allowedMint.toBase58(),
        'wrong-destination',
        '5',
        0,
      ),
      buildTransferInstruction(
        wallet.toBase58(),
        disallowedMint.toBase58(),
        'disallowed-mint',
        '5',
        0,
      ),
      missingTokenAmount,
      malformedTokenAmount,
      buildTransferInstruction(
        wallet.toBase58(),
        allowedMint.toBase58(),
        'zero-amount',
        '0',
        6,
      ),
      buildTransferInstruction(
        wallet.toBase58(),
        allowedMint.toBase58(),
        'valid-source',
        '5000000',
        6,
      ),
    ]

    const txDetails = {
      meta: { innerInstructions: [{ index: 0, instructions }] },
      transaction: { message: { instructions: [] } },
    } as unknown as ParsedTransactionWithMeta

    const transfer = verifier.findUsdcTransferToWallet(txDetails, [wallet], [allowedMint])
    expect(transfer).toEqual({ amount: 5, source: 'valid-source' })
  })
})
