import type { ParsedInstruction, ParsedTransactionWithMeta } from '@solana/web3.js'

import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '.prisma/client'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { ISecretManager, Secret } from '../../interfaces/ISecretManager'

import { SolanaPaymentsController } from '../../controllers/SolanaPaymentsController'
import { QueueName } from '../../interfaces'
import { createMockLogger, createMockQueueHandler, type MockLogger, type MockQueueHandler } from '../setup/mockFactories'

type MockedPublicKey = {
  equals(other: unknown): boolean
  toBase58(): string
  value: string
}

type MockedPublicKeyConstructor = new (value: string) => MockedPublicKey

export const mockParsedTransactions: Record<string, null | ParsedTransactionWithMeta> = {}

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
  const { PublicKey } = jest.requireMock<{ PublicKey: MockedPublicKeyConstructor }>('@solana/web3.js')
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
    getAssociatedTokenAddress: async (
      mint: unknown,
      owner: InstanceType<typeof PublicKey>,
    ) => deriveAta(mint, owner),
    TOKEN_2022_PROGRAM_ID: new TokenProgramKey('token-2022-program'),
    TOKEN_PROGRAM_ID: new TokenProgramKey('token-program'),
  }
})

export type TransactionRecord = {
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

type PrismaLike = {
  transaction: {
    findFirst: jest.Mock
    findUnique: jest.Mock
  }
}

export const onChainSignature = 'on-chain-sig'
export const transactionId = '11111111-1111-4111-8111-111111111111'
export const secrets: Record<string, string> = {
  SOLANA_ADDRESS: 'deposit-wallet',
  SOLANA_RPC_URL: 'http://solana-rpc',
  SOLANA_USDC_MINT: 'usdc-mint',
}

export const buildTransaction = (overrides?: Partial<TransactionRecord>): TransactionRecord => {
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

export const resetSolanaTestState = (): void => {
  Object.keys(mockParsedTransactions).forEach((key) => {
    delete mockParsedTransactions[key]
  })
}

export const buildTransferInstruction = (overrides?: Partial<ParsedInstruction>) => ({
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
  ...(overrides ?? {}),
})

export const setParsedTransaction = (signature: string, transaction: ParsedTransactionWithMeta) => {
  mockParsedTransactions[signature] = transaction
}

export const createControllerContext = () => {
  const prismaClient: PrismaLike = {
    transaction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  }
  prismaClient.transaction.findFirst.mockResolvedValue(null)

  const prismaProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
  } as unknown as IDatabaseClientProvider

  const secretManager: ISecretManager = {
    getSecret: jest.fn(async (secret: Secret) => secrets[secret] ?? ''),
    getSecrets: jest.fn(),
  }

  const queueHandler: MockQueueHandler = createMockQueueHandler()
  const logger: MockLogger = createMockLogger()

  const controller = new SolanaPaymentsController(
    secretManager,
    queueHandler,
    prismaProvider,
    logger,
  )

  return {
    badRequest: jest.fn(),
    controller,
    logger,
    notFound: jest.fn(),
    prismaClient,
    queueHandler,
    secretManager,
  }
}

export const expectEnqueuedMessage = (queueHandler: MockQueueHandler, amount: number) => {
  expect(queueHandler.postMessage).toHaveBeenCalledWith(QueueName.RECEIVED_CRYPTO_TRANSACTION, {
    addressFrom: 'sender-wallet',
    amount,
    blockchain: BlockchainNetwork.SOLANA,
    cryptoCurrency: CryptoCurrency.USDC,
    onChainId: onChainSignature,
    transactionId,
  })
}
