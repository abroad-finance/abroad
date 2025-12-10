import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '.prisma/client'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, type ParsedTransactionWithMeta } from '@solana/web3.js'

import { SolanaPaymentsController } from '../../controllers/SolanaPaymentsController'
import { QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secret } from '../../interfaces/ISecretManager'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../setup/mockFactories'

const mockParsedTransactions: Record<string, null | ParsedTransactionWithMeta> = {}

jest.mock('@solana/web3.js', () => {
  class PublicKey {
    value: string
    constructor(value: string) {
      this.value = value
    }

    equals(other: unknown): boolean {
      return other instanceof PublicKey && other.value === this.value
    }

    toBase58(): string {
      return this.value
    }
  }

  class Connection {
    url: string
    constructor(url: string) {
      this.url = url
    }

    async getParsedTransaction(signature: string): Promise<null | ParsedTransactionWithMeta> {
      return mockParsedTransactions[signature] ?? null
    }
  }

  return { Connection, PublicKey }
})

jest.mock('@solana/spl-token', () => {
  const { PublicKey } = require('@solana/web3.js')
  class TokenProgramKey {
    value: string
    constructor(value: string) {
      this.value = value
    }

    equals(other: unknown): boolean {
      return other instanceof TokenProgramKey && other.value === this.value
    }
  }

  const isPublicKeyLike = (candidate: unknown): candidate is InstanceType<typeof PublicKey> =>
    Boolean(candidate) && typeof candidate === 'object' && 'value' in (candidate as { value?: unknown })

  const deriveAta = (mint: unknown, owner: InstanceType<typeof PublicKey>) => {
    const ownerValue = owner.value ?? ''
    const mintValue = isPublicKeyLike(mint) ? mint.value : String(mint ?? '')
    return new PublicKey(`${ownerValue}-${mintValue}-ata`)
  }

  return {
    TOKEN_2022_PROGRAM_ID: new TokenProgramKey('token-2022-program'),
    TOKEN_PROGRAM_ID: new TokenProgramKey('token-program'),
    getAssociatedTokenAddress: async (
      mint: unknown,
      owner: InstanceType<typeof PublicKey>,
    ) => deriveAta(mint, owner),
  }
})

type PrismaLike = {
  transaction: {
    findFirst: jest.Mock
    findUnique: jest.Mock
  }
}

type TransactionRecord = {
  accountNumber: string
  bankCode: string
  id: string
  onChainId?: string
  partnerUser: { partner: { webhookUrl: string } }
  quote: {
    cryptoCurrency: CryptoCurrency
    network: BlockchainNetwork
    paymentMethod: string
    targetAmount: number
    targetCurrency: string
  }
  status: TransactionStatus
}

describe('SolanaPaymentsController.notifyPayment', () => {
  const onChainSignature = 'on-chain-sig'
  const transactionId = '11111111-1111-4111-8111-111111111111'
  const secrets: Record<string, string> = {
    SOLANA_ADDRESS: 'deposit-wallet',
    SOLANA_RPC_URL: 'http://solana-rpc',
    SOLANA_USDC_MINT: 'usdc-mint',
  }

  let prismaClient: PrismaLike
  let prismaProvider: IDatabaseClientProvider
  let secretManager: ISecretManager
  let queueHandler: MockQueueHandler
  let logger: MockLogger
  const badRequest = jest.fn()
  const notFound = jest.fn()
  const buildTransaction = (overrides?: Partial<TransactionRecord>): TransactionRecord => {
    const { quote: quoteOverride, ...restOverrides } = overrides ?? {}

    return {
      accountNumber: 'acc',
      bankCode: 'bank',
      id: transactionId,
      onChainId: undefined,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: 'nequi',
        targetAmount: 0,
        targetCurrency: 'COP',
        ...(quoteOverride ?? {}),
      },
      status: TransactionStatus.AWAITING_PAYMENT,
      ...restOverrides,
    }
  }

  beforeEach(() => {
    Object.keys(mockParsedTransactions).forEach((key) => {
      delete mockParsedTransactions[key]
    })
    badRequest.mockClear()
    notFound.mockClear()

    prismaClient = {
      transaction: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
    }
    prismaClient.transaction.findFirst.mockResolvedValue(null)
    prismaProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    secretManager = {
      getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? ''),
      getSecrets: jest.fn(),
    } as ISecretManager

    queueHandler = createMockQueueHandler()

    logger = createMockLogger()
  })

  it('enqueues a verified Solana USDC transfer to the configured wallet', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      accountNumber: 'acc',
      bankCode: 'bank',
      id: transactionId,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: 'nequi',
        targetAmount: 0,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    const transferInstruction = {
      parsed: {
        info: {
          destination: secrets.SOLANA_ADDRESS,
          mint: secrets.SOLANA_USDC_MINT,
          source: 'sender-wallet',
          tokenAmount: {
            amount: '2500000',
            decimals: 6,
            uiAmount: null,
          },
        },
        type: 'transferChecked',
      },
      programId: TOKEN_PROGRAM_ID,
    }

    mockParsedTransactions[onChainSignature] = {
      meta: { err: null },
      transaction: {
        message: {
          instructions: [transferInstruction],
        },
      },
    } as unknown as ParsedTransactionWithMeta

    const result = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    )

    expect(result).toEqual({ enqueued: true })
    expect(badRequest).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
    expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.RECEIVED_CRYPTO_TRANSACTION, {
      addressFrom: 'sender-wallet',
      amount: 2.5,
      blockchain: BlockchainNetwork.SOLANA,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: onChainSignature,
      transactionId,
    })
  })

  it('returns bad request when the on-chain transaction is missing', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      accountNumber: 'acc',
      bankCode: 'bank',
      id: transactionId,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: 'nequi',
        targetAmount: 0,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    const reason = 'Transaction not found on Solana'
    badRequest.mockImplementation((code: number, payload: { reason: string }) => {
      expect(code).toBe(400)
      expect(payload.reason).toBe(reason)
      return payload
    })

    const response = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    )

    expect(response).toEqual({ reason })
    expect(queueHandler.postMessage).not.toHaveBeenCalled()
  })

  it('rejects invalid request payloads', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const response = await controller.notifyPayment(
      { on_chain_tx: '', transaction_id: 'invalid-uuid' },
      badRequest,
      notFound,
    ) as unknown as { reason: string }

    expect(response.reason).toContain('On-chain transaction signature is required')
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns not found when the transaction does not exist', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce(null)
    notFound.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const response = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    )

    expect(response).toEqual({ reason: 'Transaction not found' })
  })

  it('validates transaction status and network before hitting Solana', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce(
      buildTransaction({ status: TransactionStatus.PROCESSING_PAYMENT }),
    )

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const wrongStatus = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    ) as unknown as { reason: string }
    expect(wrongStatus.reason).toBe('Transaction is not awaiting payment')

    prismaClient.transaction.findUnique.mockResolvedValueOnce(
      buildTransaction({ quote: { network: BlockchainNetwork.STELLAR } as TransactionRecord['quote'] }),
    )
    const wrongNetwork = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    ) as unknown as { reason: string }
    expect(wrongNetwork.reason).toBe('Transaction is not set for Solana')

    prismaClient.transaction.findUnique.mockResolvedValueOnce(
      buildTransaction({ quote: { cryptoCurrency: 'BTC' as CryptoCurrency } as TransactionRecord['quote'] }),
    )
    const wrongCurrency = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    ) as unknown as { reason: string }
    expect(wrongCurrency.reason).toBe('Unsupported currency for Solana payments')
  })

  it('prevents linking an on-chain transaction that is already associated', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())
    prismaClient.transaction.findFirst.mockResolvedValueOnce({ id: 'other-transaction' })

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const duplicate = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    ) as unknown as { reason: string }

    expect(duplicate.reason).toBe('On-chain transaction already linked to another transaction')
  })

  it('throws when Solana configuration is invalid', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())

    const getSecretMock = secretManager.getSecret as unknown as jest.Mock
    getSecretMock.mockImplementation(async (secret: Secret) => {
      if (secret === 'SOLANA_ADDRESS' || secret === 'SOLANA_USDC_MINT') {
        return ''
      }
      return secrets[secret] ?? ''
    })

    await expect(
      controller.notifyPayment(
        { on_chain_tx: onChainSignature, transaction_id: transactionId },
        badRequest,
        notFound,
      ),
    ).rejects.toThrow('Solana configuration is invalid')
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Invalid Solana configuration',
      { depositWalletAddress: '', usdcMintAddress: '' },
    )
  })

  it('handles RPC failures when fetching the on-chain transaction', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())

    const rpcSpy = jest.spyOn(Connection.prototype, 'getParsedTransaction').mockRejectedValueOnce(new Error('rpc down'))
    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const response = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    )

    expect(response).toEqual({ reason: 'Failed to fetch transaction from Solana' })
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Failed to fetch transaction from Solana',
      expect.any(Error),
    )
    rpcSpy.mockRestore()
  })

  it('rejects failed on-chain transactions and missing transfers', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )
    prismaClient.transaction.findUnique.mockResolvedValue(buildTransaction())

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    mockParsedTransactions[onChainSignature] = {
      meta: { err: { InstructionError: ['0', 'error'] } },
      transaction: {
        message: { instructions: [] },
      },
    } as unknown as ParsedTransactionWithMeta

    const failed = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    ) as unknown as { reason: string }
    expect(failed.reason).toBe('Transaction failed on-chain')

    mockParsedTransactions[onChainSignature] = {
      meta: { err: null },
      transaction: {
        message: { instructions: [] },
      },
    } as unknown as ParsedTransactionWithMeta

    const missingTransfer = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    ) as unknown as { reason: string }
    expect(missingTransfer.reason).toBe('No USDC transfer to the configured wallet found in this transaction')
  })

  it('propagates queue errors when enqueuing verified payments', async () => {
    const controller = new SolanaPaymentsController(
      secretManager,
      queueHandler,
      prismaProvider,
      logger,
    )

    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())

    const transferInstruction = {
      parsed: {
        info: {
          destination: secrets.SOLANA_ADDRESS,
          mint: secrets.SOLANA_USDC_MINT,
          source: 'sender-wallet',
          tokenAmount: {
            amount: '1000000',
            decimals: 6,
            uiAmount: null,
            uiAmountString: '1',
          },
        },
        type: 'transferChecked',
      },
      programId: TOKEN_PROGRAM_ID,
    }

    mockParsedTransactions[onChainSignature] = {
      meta: { err: null },
      transaction: {
        message: {
          instructions: [transferInstruction],
        },
      },
    } as unknown as ParsedTransactionWithMeta

    const postMock = queueHandler.postMessage as unknown as jest.Mock
    postMock.mockRejectedValueOnce(new Error('queue down'))

    await expect(
      controller.notifyPayment(
        { on_chain_tx: onChainSignature, transaction_id: transactionId },
        badRequest,
        notFound,
      ),
    ).rejects.toThrow()
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Failed to enqueue Solana payment',
      expect.any(Error),
    )
  })
})
