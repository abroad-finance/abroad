import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { ethers } from 'ethers'

import { ILogger } from '../../../../../core/logging/types'
import { CeloPaymentVerifier } from '../../../../../modules/payments/infrastructure/wallets/CeloPaymentVerifier'
import { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'

class LoggerStub implements ILogger {
  error(): void {}
  info(): void {}
  warn(): void {}
}

class SecretManagerStub implements ISecretManager {
  constructor(private readonly secrets: Partial<Record<Secret, string>>) {}

  async getSecret(secretName: Secret): Promise<string> {
    return this.secrets[secretName] ?? ''
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    const result: Record<string, string> = {}
    secretNames.forEach((name) => {
      result[name] = this.secrets[name] ?? ''
    })
    return result as Record<T[number], string>
  }
}

const buildReceipt = (params: {
  amount: ethers.BigNumber
  from: string
  to: string
  token: string
}): ethers.providers.TransactionReceipt => {
  const iface = new ethers.utils.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ])
  const { data, topics } = iface.encodeEventLog(
    iface.getEvent('Transfer'),
    [params.from, params.to, params.amount],
  )
  const log = {
    address: params.token,
    data,
    topics,
  }

  return {
    logs: [log],
    status: 1,
  } as unknown as ethers.providers.TransactionReceipt
}

describe('CeloPaymentVerifier', () => {
  const depositAddress = '0x1111111111111111111111111111111111111111'
  const senderAddress = '0x2222222222222222222222222222222222222222'
  const usdcAddress = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'
  const rpcUrl = 'http://celo-rpc.local'

  const buildVerifier = (
    dbProvider: IDatabaseClientProvider,
    overrides?: Partial<Record<Secret, string>>,
  ) => {
    const secretManager = new SecretManagerStub({
      CELO_DEPOSIT_ADDRESS: depositAddress,
      CELO_RPC_URL: rpcUrl,
      CELO_USDC_ADDRESS: usdcAddress,
      ...overrides,
    })
    return new CeloPaymentVerifier(secretManager, dbProvider, new LoggerStub())
  }

  it('returns ok for a valid USDC transfer', async () => {
    const receipt = buildReceipt({
      amount: ethers.utils.parseUnits('12.34', 6),
      from: senderAddress,
      to: depositAddress,
      token: usdcAddress,
    })

    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-1',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)
    ;(verifier as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider: {
        getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
      } as unknown as ethers.providers.JsonRpcProvider,
      rpcUrl,
    }

    const result = await verifier.verifyNotification('0xhash', 'tx-1')

    expect(result.outcome).toBe('ok')
    if (result.outcome === 'ok') {
      expect(result.queueMessage).toEqual({
        addressFrom: ethers.utils.getAddress(senderAddress),
        amount: 12.34,
        blockchain: BlockchainNetwork.CELO,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: '0xhash',
        transactionId: 'tx-1',
      })
    }
  })

  it('returns not found when the transaction does not exist', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)

    const result = await verifier.verifyNotification('0xhash', 'missing')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Transaction not found',
      status: 404,
    })
  })

  it('returns an error when the transaction is not awaiting payment', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-2',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.PAYMENT_COMPLETED,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)

    const result = await verifier.verifyNotification('0xhash', 'tx-2')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Transaction is not awaiting payment',
      status: 400,
    })
  })

  it('returns an error when the transaction is not on Celo', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-2b',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.SOLANA },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)

    const result = await verifier.verifyNotification('0xhash', 'tx-2b')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Transaction is not set for Celo',
      status: 400,
    })
  })

  it('returns an error when the currency is not supported', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-2c',
          quote: { cryptoCurrency: 'USDT' as unknown as CryptoCurrency, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)

    const result = await verifier.verifyNotification('0xhash', 'tx-2c')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Unsupported currency for Celo payments',
      status: 400,
    })
  })

  it('returns not found when the receipt is missing', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-3',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)
    ;(verifier as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider: {
        getTransactionReceipt: jest.fn().mockResolvedValue(null),
      } as unknown as ethers.providers.JsonRpcProvider,
      rpcUrl,
    }

    const result = await verifier.verifyNotification('0xhash', 'tx-3')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Transaction not found on Celo',
      status: 404,
    })
  })

  it('returns an error when the receipt fetch throws', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-3b',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)
    ;(verifier as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider: {
        getTransactionReceipt: jest.fn().mockRejectedValue(new Error('rpc down')),
      } as unknown as ethers.providers.JsonRpcProvider,
      rpcUrl,
    }

    const result = await verifier.verifyNotification('0xhash', 'tx-3b')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Failed to fetch Celo transaction',
      status: 400,
    })
  })

  it('returns an error when Celo secrets are invalid', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-3c',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider, { CELO_DEPOSIT_ADDRESS: 'not-an-address' })

    const result = await verifier.verifyNotification('0xhash', 'tx-3c')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Failed to fetch Celo transaction',
      status: 400,
    })
  })

  it('returns an error when the on-chain transaction is already linked', async () => {
    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue({ id: 'other-tx' }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-4',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)

    const result = await verifier.verifyNotification('0xhash', 'tx-4')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'On-chain transaction already linked to another transaction',
      status: 400,
    })
  })

  it('returns an error when multiple senders are detected', async () => {
    const iface = new ethers.utils.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ])
    const first = iface.encodeEventLog(
      iface.getEvent('Transfer'),
      [senderAddress, depositAddress, ethers.utils.parseUnits('1', 6)],
    )
    const second = iface.encodeEventLog(
      iface.getEvent('Transfer'),
      ['0x3333333333333333333333333333333333333333', depositAddress, ethers.utils.parseUnits('2', 6)],
    )
    const receipt = {
      logs: [
        { address: usdcAddress, data: first.data, topics: first.topics },
        { address: usdcAddress, data: second.data, topics: second.topics },
      ],
      status: 1,
    } as unknown as ethers.providers.TransactionReceipt

    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-5',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)
    ;(verifier as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider: {
        getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
      } as unknown as ethers.providers.JsonRpcProvider,
      rpcUrl,
    }

    const result = await verifier.verifyNotification('0xhash', 'tx-5')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Multiple senders found for USDC transfers',
      status: 400,
    })
  })

  it('returns an error when the transfer amount is zero', async () => {
    const receipt = buildReceipt({
      amount: ethers.BigNumber.from(0),
      from: senderAddress,
      to: depositAddress,
      token: usdcAddress,
    })

    const prismaClient = {
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'tx-6',
          quote: { cryptoCurrency: CryptoCurrency.USDC, network: BlockchainNetwork.CELO },
          status: TransactionStatus.AWAITING_PAYMENT,
        }),
      },
    }

    const dbProvider: IDatabaseClientProvider = {
      getClient: async () => prismaClient as unknown as import('@prisma/client').PrismaClient,
    }

    const verifier = buildVerifier(dbProvider)
    ;(verifier as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider: {
        getTransactionReceipt: jest.fn().mockResolvedValue(receipt),
      } as unknown as ethers.providers.JsonRpcProvider,
      rpcUrl,
    }

    const result = await verifier.verifyNotification('0xhash', 'tx-6')

    expect(result).toEqual({
      outcome: 'error',
      reason: 'Invalid USDC transfer amount',
      status: 400,
    })
  })
})
