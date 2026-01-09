import { CryptoCurrency } from '@prisma/client'

import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { SolanaWalletHandler } from '../../../../../modules/payments/infrastructure/wallets/SolanaWalletHandler'
import { createMockLogger, MockLogger } from '../../../../setup/mockFactories'

const getOrCreateAssociatedTokenAccountMock = jest.fn()
const createTransferInstructionMock = jest.fn()
const sendTransactionMock = jest.fn()
const confirmTransactionMock = jest.fn()

jest.mock('@solana/spl-token', () => ({
  createTransferInstruction: (...args: unknown[]) => createTransferInstructionMock(...args),
  getOrCreateAssociatedTokenAccount: (...args: unknown[]) => getOrCreateAssociatedTokenAccountMock(...args),
}))

jest.mock('@solana/web3.js', () => {
  class PublicKey {
    value: string
    constructor(value: string) {
      this.value = value
    }
  }

  class Keypair {
    publicKey: PublicKey
    constructor() {
      this.publicKey = new PublicKey('sender')
    }

    static fromSecretKey(key: Uint8Array): Keypair {
      void key
      return new Keypair()
    }

    static fromSeed(seed: Uint8Array): Keypair {
      void seed
      return new Keypair()
    }
  }

  class Connection {
    commitment: string
    url: string
    constructor(url: string, commitment: string) {
      this.url = url
      this.commitment = commitment
    }

    async confirmTransaction(_strategy: unknown) {
      return confirmTransactionMock(_strategy)
    }

    async getAccountInfo(pubkey: PublicKey) {
      return { exists: Boolean(pubkey) }
    }

    async getLatestBlockhash() {
      return { blockhash: 'blockhash-1', lastValidBlockHeight: 100 }
    }

    async sendTransaction(_tx: unknown) {
      return sendTransactionMock(_tx) ?? 'sig-123'
    }
  }

  class TransactionMessage {
    private readonly props: { instructions: unknown[], payerKey: PublicKey, recentBlockhash: string }
    constructor(props: { instructions: unknown[], payerKey: PublicKey, recentBlockhash: string }) {
      this.props = props
    }

    compileToV0Message() {
      return { ...this.props, compiled: true }
    }
  }

  class VersionedTransaction {
    readonly message: unknown
    constructor(message: unknown) {
      this.message = message
    }

    sign(keys: unknown[]) {
      void keys
      return undefined
    }
  }

  return { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction }
})

jest.mock('bs58', () => ({
  decode: () => new Uint8Array(Array.from({ length: 32 }, (_, idx) => idx)),
}))

describe('SolanaWalletHandler.send', () => {
  let secretManager: ISecretManager
  let logger: MockLogger

  beforeEach(() => {
    jest.clearAllMocks()
    getOrCreateAssociatedTokenAccountMock.mockResolvedValue({ address: 'token-account' })
    createTransferInstructionMock.mockReturnValue('ix-transfer')
    sendTransactionMock.mockResolvedValue('sig-123')
    confirmTransactionMock.mockResolvedValue({ value: { err: null } })
    secretManager = {
      getSecret: jest.fn(async (name: string) => {
        if (name === 'SOLANA_RPC_URL') return 'http://rpc'
        if (name === 'SOLANA_PRIVATE_KEY') return 'base58-key'
        if (name === 'SOLANA_USDC_MINT') return 'usdc-mint'
        return ''
      }),
      getSecrets: jest.fn(),
    }
    logger = createMockLogger()
  })

  it('sends a USDC transfer and returns the signature', async () => {
    const handler = new SolanaWalletHandler(secretManager, logger)

    const result = await handler.send({
      address: 'dest-wallet',
      amount: 1.25,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({ success: true, transactionId: 'sig-123' })
    expect(secretManager.getSecret).toHaveBeenCalledWith('SOLANA_RPC_URL')
    expect(secretManager.getSecret).toHaveBeenCalledWith('SOLANA_PRIVATE_KEY')
    expect(secretManager.getSecret).toHaveBeenCalledWith('SOLANA_USDC_MINT')
    expect(getOrCreateAssociatedTokenAccountMock).toHaveBeenCalledTimes(2)
    expect(createTransferInstructionMock).toHaveBeenCalled()
    expect(sendTransactionMock).toHaveBeenCalled()
    expect(confirmTransactionMock).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns failure for unsupported cryptocurrency', async () => {
    const handler = new SolanaWalletHandler(secretManager, logger)

    const result = await handler.send({
      address: 'dest',
      amount: 1,
      cryptoCurrency: 'BTC' as CryptoCurrency,
    })

    expect(result).toEqual({ code: 'validation', reason: 'unsupported_currency', success: false })
    expect(secretManager.getSecret).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('Unsupported cryptocurrency for Solana', 'BTC')
  })

  it('handles downstream errors gracefully', async () => {
    const handler = new SolanaWalletHandler(secretManager, logger)
    sendTransactionMock.mockRejectedValueOnce(new Error('network down'))

    const result = await handler.send({
      address: 'dest-wallet',
      amount: 2,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({ code: 'retriable', reason: 'network down', success: false })
    expect(logger.error).toHaveBeenCalled()
  })
})
