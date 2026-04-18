import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, type ParsedInstruction, type ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'

import type { ILogger } from '../../../../../core/logging/types'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { SolanaPaymentVerifier } from '../../../../../modules/payments/infrastructure/wallets/SolanaPaymentVerifier'
import * as depositVerification from '../../../../../modules/payments/infrastructure/wallets/depositVerification'
import { type ISecretManager } from '../../../../../platform/secrets/ISecretManager'

const buildVerifier = () => {
  const secretManager: ISecretManager = { getSecret: jest.fn(), getSecrets: jest.fn() }
  const dbProvider: IDatabaseClientProvider = { getClient: jest.fn(async () => ({} as never)) }
  const logger: ILogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const assetConfigService = { getActiveMint: jest.fn(async () => ({ mintAddress: TOKEN_PROGRAM_ID.toBase58() })) }
  return { logger, secretManager, verifier: new SolanaPaymentVerifier(secretManager, dbProvider, assetConfigService as never, logger) }
}

const buildTransferInstruction = (
  destination: string,
  mint: string,
  source: string,
  authority: string,
  amount: string,
  decimals: number,
): ParsedInstruction => ({
  parsed: { info: { authority, destination, mint, source, tokenAmount: { amount, decimals } }, type: 'transferChecked' },
  program: 'spl-token',
  programId: TOKEN_PROGRAM_ID,
} as ParsedInstruction)

describe('SolanaPaymentVerifier helpers', () => {
  it('throws when Solana configuration secrets are invalid', async () => {
    const { logger, secretManager, verifier } = buildVerifier()
    secretManager.getSecret = jest.fn(async () => 'invalid-key')
    await expect(verifier.buildPaymentContext(CryptoCurrency.USDC)).rejects.toThrow('Solana configuration is invalid')
    expect(logger.error).toHaveBeenCalledWith('[SolanaPaymentsController] Invalid Solana configuration', expect.objectContaining({ depositWalletAddress: 'invalid-key' }))
  })

  it('finds token transfer to wallet', () => {
    const { verifier } = buildVerifier()
    const wallet = new PublicKey('5enWnVoUGq1i7P2TLXeC1xVq5YGWHzKWTS2KkPK7x9rP')
    const allowedMint = new PublicKey('So11111111111111111111111111111111111111112')
    const txDetails = {
      meta: { innerInstructions: [{ index: 0, instructions: [buildTransferInstruction(wallet.toBase58(), allowedMint.toBase58(), 'valid-source', 'sender-wallet', '5000000', 6)] }] },
      transaction: { message: { instructions: [] } },
    } as unknown as ParsedTransactionWithMeta

    const transfer = verifier.findTokenTransferToWallet(txDetails, [wallet], [allowedMint])
    expect(transfer).toEqual({
      amount: 5,
      transferInfo: expect.objectContaining({ authority: 'sender-wallet', source: 'valid-source' }),
    })
  })

  it('returns transfer with undefined authority when authority is missing from instruction', () => {
    const { verifier } = buildVerifier()
    const wallet = new PublicKey('5enWnVoUGq1i7P2TLXeC1xVq5YGWHzKWTS2KkPK7x9rP')
    const allowedMint = new PublicKey('So11111111111111111111111111111111111111112')
    const instructionWithoutAuthority: ParsedInstruction = {
      parsed: { info: { destination: wallet.toBase58(), mint: allowedMint.toBase58(), source: 'token-account-addr', tokenAmount: { amount: '1000000', decimals: 6 } }, type: 'transferChecked' },
      program: 'spl-token',
      programId: TOKEN_PROGRAM_ID,
    } as ParsedInstruction
    const txDetails = {
      meta: { innerInstructions: [{ index: 0, instructions: [instructionWithoutAuthority] }] },
      transaction: { message: { instructions: [] } },
    } as unknown as ParsedTransactionWithMeta

    const transfer = verifier.findTokenTransferToWallet(txDetails, [wallet], [allowedMint])
    expect(transfer).toEqual({
      amount: 1,
      transferInfo: expect.objectContaining({ authority: undefined, source: 'token-account-addr' }),
    })
  })

  it('maps Solana RPC failures to client-friendly errors', async () => {
    const { logger, verifier } = buildVerifier()
    const prismaClient = { transaction: { findUnique: jest.fn(async () => ({ id: 'txn-1', quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.SOLANA }, status: TransactionStatus.AWAITING_PAYMENT })) } } as never
    jest.spyOn(verifier, 'getPrismaClient').mockResolvedValue(prismaClient)
    jest.spyOn(depositVerification, 'ensureUniqueOnChainId').mockResolvedValue(undefined)
    jest.spyOn(verifier, 'buildPaymentContext').mockResolvedValue({ assetMint: TOKEN_PROGRAM_ID, connection: {} as Connection, tokenAccounts: [] })
    jest.spyOn(verifier, 'fetchOnChainTransaction').mockRejectedValueOnce(new Error('Transaction failed on-chain'))
    const result = await verifier.verifyNotification('on-chain-sig', 'txn-1')
    expect(result).toEqual({ outcome: 'error', reason: 'Transaction failed on-chain', status: 400 })
    expect(logger.error).toHaveBeenCalled()
  })

  it('allows PAYMENT_EXPIRED transactions during validation for refund processing', async () => {
    const { verifier } = buildVerifier()

    const validationError = await verifier.validateTransaction({
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
      },
      status: TransactionStatus.PAYMENT_EXPIRED,
    })

    expect(validationError).toBeUndefined()
  })
})
