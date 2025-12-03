import 'reflect-metadata'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'

import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '.prisma/client'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

import { SolanaPaymentsController } from '../../controllers/SolanaPaymentsController'
import { IQueueHandler } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secret } from '../../interfaces/ISecretManager'

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
  class TokenProgramKey {
    value: string
    constructor(value: string) {
      this.value = value
    }

    equals(other: unknown): boolean {
      return other instanceof TokenProgramKey && other.value === this.value
    }
  }

  return { TOKEN_PROGRAM_ID: new TokenProgramKey('token-program') }
})

type PrismaLike = {
  transaction: {
    findFirst: jest.Mock
    findUnique: jest.Mock
  }
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
  let queueHandler: IQueueHandler
  let logger: { error: jest.Mock, info: jest.Mock, warn: jest.Mock }
  const badRequest = jest.fn()
  const notFound = jest.fn()

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

    queueHandler = {
      postMessage: jest.fn(async () => undefined),
      subscribeToQueue: jest.fn(),
    } as IQueueHandler

    logger = {
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    }
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
    expect(queueHandler.postMessage).toHaveBeenCalledWith('received-crypto-transaction', {
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
})
