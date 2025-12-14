import 'reflect-metadata'
import { MainClient } from 'binance'

import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager } from '../../../../../platform/secrets/ISecretManager'

import { BinanceBalanceUpdatedController } from '../../../../../modules/treasury/interfaces/queue/BinanceBalanceUpdatedController'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../../setup/mockFactories'

jest.mock('binance', () => {
  const submitNewOrder = jest.fn(async () => undefined)
  const getBalances = jest.fn(async () => [])
  const MainClientMock = jest.fn().mockImplementation(() => ({
    getBalances,
    submitNewOrder,
  }))

  return { MainClient: MainClientMock }
})

type PendingConversion = {
  amount: number
  side: 'BUY' | 'SELL'
  source: string
  symbol: string
  target: string
}

describe('BinanceBalanceUpdatedController', () => {
  let logger: MockLogger
  let queueHandler: MockQueueHandler
  let secretManager: ISecretManager

  const buildDb = (pending: PendingConversion[], updateManyCounts: number[]) => {
    const updateMany = jest.fn()
    updateManyCounts.forEach(count => updateMany.mockResolvedValueOnce({ count }))

    const db = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<void>) => {
        return cb({ pendingConversions: { updateMany } })
      }),
      pendingConversions: {
        findMany: jest.fn(async () => pending),
        updateMany,
      },
    }
    const provider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => db as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider
    return { db, provider, updateMany }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    logger = createMockLogger()
    queueHandler = createMockQueueHandler()
    secretManager = {
      getSecret: jest.fn(async () => 'secret'),
      getSecrets: jest.fn(),
    }
  })

  it('registers the consumer', () => {
    const controller = new BinanceBalanceUpdatedController(
      logger,
      queueHandler,
      secretManager,
      { getClient: jest.fn() } as unknown as IDatabaseClientProvider,
    )
    controller.registerConsumers()
    expect(queueHandler.subscribeToQueue).toHaveBeenCalled()
  })

  it('processes pending conversions and skips already-reserved quantities', async () => {
    const pending: PendingConversion[] = [
      { amount: 0, side: 'SELL', source: 'USDC', symbol: 'USDCUSDT', target: 'USDT' }, // qty<=0 branch
      { amount: 2, side: 'SELL', source: 'USDC', symbol: 'USDCUSDT', target: 'USDT' }, // update count 0 branch
      { amount: 5, side: 'SELL', source: 'USDT', symbol: 'USDTCOP', target: 'COP' }, // successful branch
    ]
    const { db, provider, updateMany } = buildDb(pending, [0, 1])
    ;(MainClient as jest.Mock).mockImplementation(() => ({
      getBalances: jest.fn(async () => [
        { coin: 'USDC', free: '10' },
        { coin: 'USDT', free: '8' },
      ]),
      submitNewOrder: jest.fn(async () => undefined),
    }))

    const controller = new BinanceBalanceUpdatedController(
      logger,
      queueHandler,
      secretManager,
      provider,
    )
    const runner = controller as unknown as { onBalanceUpdated: () => Promise<void> }
    await runner.onBalanceUpdated()

    expect(db.pendingConversions.findMany).toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect((MainClient as jest.Mock).mock.calls[0][0]).toMatchObject({
      api_key: 'secret',
      api_secret: 'secret',
      baseUrl: 'secret',
    })
  })

  it('logs errors when processing fails', async () => {
    const provider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => {
        throw new Error('db down')
      }),
    } as unknown as IDatabaseClientProvider

    const controller = new BinanceBalanceUpdatedController(
      logger,
      queueHandler,
      secretManager,
      provider,
    )
    const runner = controller as unknown as { onBalanceUpdated: () => Promise<void> }
    await runner.onBalanceUpdated()

    expect(logger.error).toHaveBeenCalledWith(
      '[BinanceBalanceUpdated queue]: Error processing balance update:',
      expect.any(Error),
    )
  })
})
