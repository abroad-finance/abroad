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

  it('rejects invalid messages before processing', async () => {
    const controller = new BinanceBalanceUpdatedController(
      logger,
      queueHandler,
      secretManager,
      { getClient: jest.fn() } as unknown as IDatabaseClientProvider,
    )
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }

    await expect(runner.onBalanceUpdated({ invalid: true })).rejects.toThrow(/Invalid binance balance update message/)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
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
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }
    await runner.onBalanceUpdated({})

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
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }
    await expect(runner.onBalanceUpdated({})).rejects.toThrow()

    expect(logger.error).toHaveBeenCalledWith(
      '[BinanceBalanceUpdated queue] Error processing balance update:',
      expect.any(Error),
    )
  })

  it('retries write conflicts before succeeding', async () => {
    const conflictError = Object.assign(
      new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'),
      { code: 'P2034' },
    )

    const updateMany = jest.fn()
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({ count: 1 })

    const db = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<void>) => cb({ pendingConversions: { updateMany } })),
      pendingConversions: {
        findMany: jest.fn(async () => [
          { amount: 3, side: 'SELL', source: 'USDT', symbol: 'USDTCOP', target: 'COP' },
        ]),
      },
    }

    const provider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => db as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    const submitNewOrder = jest.fn(async () => undefined)
    const getBalances = jest.fn(async () => [{ coin: 'USDT', free: '4' }])
    ;(MainClient as jest.Mock).mockImplementation(() => ({
      getBalances,
      submitNewOrder,
    }))

    const controller = new BinanceBalanceUpdatedController(
      logger,
      queueHandler,
      secretManager,
      provider,
    )
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }
    const controllerInternals = controller as unknown as { delay: jest.Mock }
    controllerInternals.delay = jest.fn(async () => undefined)

    await runner.onBalanceUpdated({})

    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(submitNewOrder).toHaveBeenCalledTimes(1)
    expect(db.$transaction).toHaveBeenCalledTimes(2)
  })

  it('restores the reserved amount when the market order fails', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const restoreUpdate = jest.fn().mockResolvedValue({ count: 1 })

    const db = {
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ pendingConversions: { update: restoreUpdate, updateMany } })),
      pendingConversions: {
        findMany: jest.fn(async () => [
          { amount: 2, side: 'SELL', source: 'USDT', symbol: 'USDTCOP', target: 'COP' },
        ]),
      },
    }

    const provider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => db as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider

    const submitNewOrder = jest.fn(async () => {
      throw new Error('binance down')
    })
    const getBalances = jest.fn(async () => [{ coin: 'USDT', free: '2' }])
    ;(MainClient as jest.Mock).mockImplementation(() => ({
      getBalances,
      submitNewOrder,
    }))

    const controller = new BinanceBalanceUpdatedController(
      logger,
      queueHandler,
      secretManager,
      provider,
    )
    const runner = controller as unknown as { onBalanceUpdated: (msg: unknown) => Promise<void> }
    const controllerInternals = controller as unknown as { delay: jest.Mock }
    controllerInternals.delay = jest.fn(async () => undefined)

    await expect(runner.onBalanceUpdated({})).rejects.toThrow('binance down')

    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(restoreUpdate).toHaveBeenCalledWith({
      data: { amount: { increment: 2 } },
      where: { source_target: { source: 'USDT', target: 'COP' } },
    })
    expect(db.$transaction).toHaveBeenCalledTimes(2)
  })
})
