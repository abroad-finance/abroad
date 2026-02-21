import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, type ParsedInstruction, type ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'

import type { ILogger } from '../../../../../core/logging/types'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { SolanaPaymentVerifier } from '../../../../../modules/payments/infrastructure/wallets/SolanaPaymentVerifier'
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
  amount: string,
  decimals: number,
): ParsedInstruction => ({
  parsed: { info: { destination, mint, source, tokenAmount: { amount, decimals } }, type: 'transferChecked' },
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
      meta: { innerInstructions: [{ index: 0, instructions: [buildTransferInstruction(wallet.toBase58(), allowedMint.toBase58(), 'valid-source', '5000000', 6)] }] },
      transaction: { message: { instructions: [] } },
    } as unknown as ParsedTransactionWithMeta

    const transfer = verifier.findTokenTransferToWallet(txDetails, [wallet], [allowedMint])
    expect(transfer).toEqual({ amount: 5, source: 'valid-source' })
  })

  it('maps Solana RPC failures to client-friendly errors', async () => {
    const { logger, verifier } = buildVerifier()
    const prismaClient = { transaction: { findUnique: jest.fn(async () => ({ id: 'txn-1', quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.SOLANA }, status: TransactionStatus.AWAITING_PAYMENT })) } } as never
    jest.spyOn(verifier, 'getPrismaClient').mockResolvedValue(prismaClient)
    jest.spyOn(verifier, 'ensureUniqueOnChainId').mockResolvedValue(undefined)
    jest.spyOn(verifier, 'buildPaymentContext').mockResolvedValue({ connection: {} as Connection, tokenAccounts: [], assetMint: TOKEN_PROGRAM_ID })
    jest.spyOn(verifier, 'fetchOnChainTransaction').mockRejectedValueOnce(new Error('Transaction failed on-chain'))
    const result = await verifier.verifyNotification('on-chain-sig', 'txn-1')
    expect(result).toEqual({ outcome: 'error', reason: 'Transaction failed on-chain', status: 400 })
    expect(logger.error).toHaveBeenCalled()
  })
})
