import 'reflect-metadata'
import { CryptoCurrency } from '@prisma/client'

import { SolanaWalletHandler } from '../../../../../modules/payments/infrastructure/wallets/SolanaWalletHandler'
import { Secrets } from '../../../../../platform/secrets/ISecretManager'

const connectionMock = {
  confirmTransaction: jest.fn(),
  getLatestBlockhash: jest.fn(),
  sendTransaction: jest.fn(),
}

jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn(() => connectionMock),
  Keypair: { fromSecretKey: jest.fn(() => ({ publicKey: { toBase58: () => 'sender' } })), fromSeed: jest.fn(() => ({ publicKey: { toBase58: () => 'seed' } })) },
  PublicKey: jest.fn((value: string) => ({ toBase58: () => value })),
  TransactionMessage: jest.fn(function (this: { compileToV0Message: () => unknown }) { this.compileToV0Message = () => ({ compiled: true }) }),
  VersionedTransaction: jest.fn(function () { this.sign = jest.fn() }),
}))

const getMintMock = jest.fn()
jest.mock('@solana/spl-token', () => ({
  createTransferInstruction: jest.fn(() => ({ instruction: true })),
  getOrCreateAssociatedTokenAccount: jest.fn(async () => ({ address: 'associated-account' })),
  getMint: (...args: unknown[]) => getMintMock(...args),
  TOKEN_2022_PROGRAM_ID: { toBase58: () => 'tp22' },
  TOKEN_PROGRAM_ID: { toBase58: () => 'tp' },
}))

const buildHandler = () => {
  const secretManager = { getSecret: jest.fn(async (key: string) => key === Secrets.SOLANA_PRIVATE_KEY ? '3Lw5wZbLv' : 'http://localhost:8899') }
  const assetConfigService = { getActiveMint: jest.fn(async ({ cryptoCurrency }: { cryptoCurrency: CryptoCurrency }) => cryptoCurrency === CryptoCurrency.USDC ? ({ mintAddress: 'mint-address', decimals: 6 }) : null) }
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const handler = new SolanaWalletHandler(secretManager as never, assetConfigService as never, logger as never)
  return { assetConfigService, handler, logger }
}

describe('SolanaWalletHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getMintMock.mockResolvedValue({ decimals: 6 })
    connectionMock.getLatestBlockhash.mockResolvedValue({ blockhash: 'bh', lastValidBlockHeight: 10 })
    connectionMock.sendTransaction.mockResolvedValue('sig-1')
    connectionMock.confirmTransaction.mockResolvedValue({ value: { err: null } })
  })

  it('rejects unsupported currencies', async () => {
    const { handler, logger } = buildHandler()
    const result = await handler.send({ address: 'dest', amount: 1, cryptoCurrency: 'USDT' as CryptoCurrency })
    expect(result).toEqual({ code: 'validation', reason: 'unsupported_currency', success: false })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('surfaces validation errors from amount conversion', async () => {
    const { handler } = buildHandler()
    const result = await handler.send({ address: 'dest', amount: -1, cryptoCurrency: CryptoCurrency.USDC })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.reason).toContain('Invalid amount')
  })
})
