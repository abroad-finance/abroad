import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  PrismaClient,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import { ILogger } from '../../../../core/logging/types'
import { PublicCorridorService } from '../../../../modules/flows/application/PublicCorridorService'
import { TransparencyMetricsService } from '../../../../modules/transparency/application/TransparencyMetricsService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

type MockPrisma = {
  $queryRaw: jest.Mock
  partner: { count: jest.Mock }
  partnerUser: { count: jest.Mock }
  quote: { aggregate: jest.Mock }
  transaction: { groupBy: jest.Mock }
}

const statusRows = (
  values: Partial<Record<TransactionStatus, number>>,
): Array<{ _count: { _all: number }, status: TransactionStatus }> => (
  Object.entries(values).map(([status, count]) => ({
    _count: { _all: count ?? 0 },
    status: status as TransactionStatus,
  }))
)

const githubResponse = (
  body: unknown,
  link?: string,
): Response => new Response(JSON.stringify(body), {
  headers: {
    'content-type': 'application/json',
    ...(link ? { link } : {}),
  },
  status: 200,
})

const buildGitHubFetch = (): jest.MockedFunction<typeof fetch> => (
  jest.fn(async (input) => {
    const url = String(input)
    if (url.includes('/search/issues') && url.includes('is:issue')) {
      return githubResponse({ total_count: 2 })
    }
    if (url.includes('/search/issues') && url.includes('is:pr')) {
      return githubResponse({ total_count: 7 })
    }
    if (url.includes('/contributors')) {
      return githubResponse(
        [{ login: 'first' }],
        '<https://api.github.com/repositories/1/contributors?anon=1&per_page=1&page=10>; rel="last"',
      )
    }
    if (url.includes('/commits')) {
      return githubResponse(
        [{ sha: 'abc' }],
        '<https://api.github.com/repositories/1/commits?per_page=1&page=51>; rel="last"',
      )
    }
    return githubResponse({
      default_branch: 'main',
      forks_count: 3,
      pushed_at: '2026-07-27T09:00:00.000Z',
      stargazers_count: 4,
    })
  }) as jest.MockedFunction<typeof fetch>
)

const buildPrisma = (): MockPrisma => {
  const allStatuses = statusRows({
    [TransactionStatus.AWAITING_PAYMENT]: 5,
    [TransactionStatus.PAYMENT_COMPLETED]: 100,
    [TransactionStatus.PAYMENT_EXPIRED]: 5,
    [TransactionStatus.PAYMENT_FAILED]: 20,
  })
  const rollingStatuses = statusRows({
    [TransactionStatus.PAYMENT_COMPLETED]: 8,
    [TransactionStatus.PAYMENT_FAILED]: 2,
    [TransactionStatus.PROCESSING_PAYMENT]: 1,
  })

  return {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([
        {
          count: 8n,
          periodStart: '2026-07-27',
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
        {
          count: 2n,
          periodStart: '2026-07-27',
          status: TransactionStatus.PAYMENT_FAILED,
        },
        {
          count: 1n,
          periodStart: '2026-07-27',
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
      ])
      .mockResolvedValueOnce([
        {
          count: 12n,
          periodStart: '2024-10-01',
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
        {
          count: 1n,
          periodStart: '2024-12-01',
          status: TransactionStatus.PAYMENT_FAILED,
        },
        {
          count: 8n,
          periodStart: '2026-07-01',
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
        {
          count: 2n,
          periodStart: '2026-07-01',
          status: TransactionStatus.PAYMENT_FAILED,
        },
        {
          count: 1n,
          periodStart: '2026-07-01',
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
      ]),
    partner: {
      count: jest.fn(async (params?: unknown) => params ? 6 : 51),
    },
    partnerUser: {
      count: jest.fn(async (params?: unknown) => params ? 24 : 538),
    },
    quote: {
      aggregate: jest.fn(async (params: {
        where: {
          cryptoCurrency: CryptoCurrency
          transaction: { is: { createdAt?: { gte: Date }, status: TransactionStatus } }
        }
      }) => {
        const rolling = params.where.transaction.is.createdAt !== undefined
        const asset = params.where.cryptoCurrency
        const amount = asset === CryptoCurrency.USDC
          ? (rolling ? 450.5 : 8_700.25)
          : (rolling ? 25 : 310)
        return { _sum: { sourceAmount: amount } }
      }),
    },
    transaction: {
      groupBy: jest.fn()
        .mockResolvedValueOnce(allStatuses)
        .mockResolvedValueOnce(rollingStatuses),
    },
  }
}

const buildService = (fetchMock = buildGitHubFetch()): {
  fetchMock: jest.MockedFunction<typeof fetch>
  logger: ILogger
  prisma: MockPrisma
  service: TransparencyMetricsService
} => {
  const prisma = buildPrisma()
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  const corridorService = {
    list: jest.fn(async () => ({
      corridors: [
        {
          blockchain: BlockchainNetwork.STELLAR,
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: CryptoCurrency.USDC,
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: null, required: false },
          paymentMethod: PaymentMethod.BREB,
          targetCurrency: TargetCurrency.COP,
          walletConnect: null,
        },
        {
          blockchain: BlockchainNetwork.CELO,
          chainFamily: 'evm',
          chainId: '42220',
          cryptoCurrency: CryptoCurrency.USDT,
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: '/payments/notify', required: true },
          paymentMethod: PaymentMethod.PIX,
          targetCurrency: TargetCurrency.BRL,
          walletConnect: null,
        },
      ],
    })),
  } as unknown as PublicCorridorService
  const logger: ILogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  global.fetch = fetchMock

  return {
    fetchMock,
    logger,
    prisma,
    service: new TransparencyMetricsService(dbProvider, corridorService, logger),
  }
}

const originalFetch = global.fetch

describe('TransparencyMetricsService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-07-27T12:00:00.000Z'))
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('returns current aggregate platform and open-source metrics without row data', async () => {
    const { service } = buildService()

    const result = await service.getMetrics()

    expect(result.platform.totals).toEqual(expect.objectContaining({
      acceptedTransactions: 130,
      completedTransactions: 100,
      completionRate: 80,
      partnerOrganizations: 51,
      userRecords: 538,
    }))
    expect(result.platform.rolling30Days).toEqual(expect.objectContaining({
      acceptedTransactions: 11,
      activePartnerOrganizations: 6,
      activeUserRecords: 24,
      completedTransactions: 8,
      completionRate: 80,
    }))
    expect(result.platform.coverage).toEqual({
      corridors: 2,
      networks: ['CELO', 'STELLAR'],
      payoutCurrencies: ['BRL', 'COP'],
      payoutMethods: ['BREB', 'PIX'],
      sourceAssets: ['USDC', 'USDT'],
    })
    expect(result.platform.dailyOutcomes).toHaveLength(30)
    expect(result.platform.dailyOutcomes.at(-1)).toEqual({
      accepted: 11,
      completed: 8,
      date: '2026-07-27',
      failed: 2,
      inFlight: 1,
      otherTerminal: 0,
    })
    expect(result.platform.history).toEqual(expect.objectContaining({
      granularity: 'month',
      outcomes: expect.arrayContaining([
        {
          accepted: 12,
          completed: 12,
          failed: 0,
          inFlight: 0,
          otherTerminal: 0,
          periodStart: '2024-10-01',
        },
        {
          accepted: 0,
          completed: 0,
          failed: 0,
          inFlight: 0,
          otherTerminal: 0,
          periodStart: '2024-11-01',
        },
      ]),
    }))
    expect(result.platform.history.outcomes).toHaveLength(22)
    expect(result.platform.history.outcomes.at(-1)).toEqual({
      accepted: 11,
      completed: 8,
      failed: 2,
      inFlight: 1,
      otherTerminal: 0,
      periodStart: '2026-07-01',
    })
    expect(result.openSource).toEqual(expect.objectContaining({
      cache: 'fresh',
      commitsLast90Days: 51,
      contributors: 10,
      forks: 3,
      openIssues: 2,
      openPullRequests: 7,
      stars: 4,
    }))
    expect(JSON.stringify(result)).not.toMatch(/partnerUserId|transactionId|accountNumber|taxId/)
  })

  it('deduplicates concurrent refreshes for both metric sources', async () => {
    const {
      fetchMock,
      prisma,
      service,
    } = buildService()

    await Promise.all([service.getMetrics(), service.getMetrics()])

    expect(prisma.transaction.groupBy).toHaveBeenCalledTimes(2)
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('keeps platform metrics available when GitHub is unavailable', async () => {
    const failingFetch = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >(async () => new Response('Unavailable', { status: 503 }))
    const {
      logger,
      service,
    } = buildService(failingFetch)

    const result = await service.getMetrics()

    expect(result.platform.totals.partnerOrganizations).toBe(51)
    expect(result.openSource).toEqual(expect.objectContaining({
      cache: 'unavailable',
      repository: 'abroad-finance/abroad',
      stars: null,
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      '[TransparencyMetricsService] Refresh failed',
      expect.objectContaining({ source: 'GitHub' }),
    )
  })
})
