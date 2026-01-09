import 'reflect-metadata'
import { CryptoCurrency } from '@prisma/client'

import { SolanaWalletHandler } from '../../../../../modules/payments/infrastructure/wallets/SolanaWalletHandler'
import { Secrets } from '../../../../../platform/secrets/ISecretManager'

const connectionMock = {
  confirmTransaction: jest.fn(),
  getAccountInfo: jest.fn(),
  getLatestBlockhash: jest.fn(),
  sendTransaction: jest.fn(),
}

class FakePublicKey {
  public constructor(public readonly value: string) {}
}

jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn(() => connectionMock),
  Keypair: {
    fromSecretKey: jest.fn(() => ({ publicKey: new FakePublicKey('sender'), secretKey: new Uint8Array(64) })),
    fromSeed: jest.fn(() => ({ publicKey: new FakePublicKey('seed'), secretKey: new Uint8Array(32) })),
  },
  PublicKey: jest.fn((value: string) => new FakePublicKey(value)),
  TransactionMessage: jest.fn(function (this: { compileToV0Message: () => unknown }) {
    this.compileToV0Message = () => ({ compiled: true })
  }),
  VersionedTransaction: jest.fn(function () {
    this.sign = jest.fn()
  }),
}))

jest.mock('@solana/spl-token', () => ({
  createTransferInstruction: jest.fn(() => ({ instruction: true })),
  getOrCreateAssociatedTokenAccount: jest.fn(async () => ({ address: 'associated-account' })),
}))

const buildHandler = () => {
  const secretManager = {
    getSecret: jest.fn(async (key: string) => {
      switch (key) {
        case Secrets.SOLANA_PRIVATE_KEY:
          return '3Lw5wZbLv'
        case Secrets.SOLANA_RPC_URL:
          return 'http://localhost:8899'
        case Secrets.SOLANA_USDC_MINT:
          return 'mint-address'
        default:
          return ''
      }
    }),
  }
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const handler = new SolanaWalletHandler(secretManager as never, logger as never)
  return { handler, logger, secretManager }
}

describe('SolanaWalletHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    connectionMock.getAccountInfo.mockResolvedValue({ exists: true })
    connectionMock.getLatestBlockhash.mockResolvedValue({ blockhash: 'bh', lastValidBlockHeight: 10 })
    connectionMock.sendTransaction.mockResolvedValue('sig-1')
    connectionMock.confirmTransaction.mockResolvedValue({ value: { err: null } })
  })

  it('rejects unsupported currencies', async () => {
    const { handler, logger } = buildHandler()
    const result = await handler.send({
      address: 'dest',
      amount: 1,
      cryptoCurrency: 'USDT' as CryptoCurrency,
    })

    expect(result).toEqual({ code: 'validation', reason: 'unsupported_currency', success: false })
    expect(logger.warn).toHaveBeenCalledWith('Unsupported cryptocurrency for Solana', 'USDT')
  })

  it('handles missing mint information gracefully', async () => {
    const { handler, logger } = buildHandler()
    connectionMock.getAccountInfo.mockResolvedValueOnce(null)

    const result = await handler.send({
      address: 'dest',
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toContain('USDC mint not found')
    }
    expect(logger.error).toHaveBeenCalledWith(
      'Error sending Solana transaction',
      expect.objectContaining({ reason: expect.stringContaining('USDC mint not found') }),
    )
  })

  it('surfaces validation errors from amount conversion', async () => {
    const { handler, logger } = buildHandler()

    const result = await handler.send({
      address: 'dest',
      amount: -1,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toContain('Invalid amount')
    }
    expect(logger.error).toHaveBeenCalledWith(
      'Error sending Solana transaction',
      expect.objectContaining({ reason: expect.stringContaining('Invalid amount') }),
    )
  })
})
