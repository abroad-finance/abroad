import type { Request } from 'express'

import { SupportedCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IExchangeProvider } from '../../interfaces/IExchangeProvider'
import type { IExchangeProviderFactory } from '../../interfaces/IExchangeProviderFactory'

import { ConversionController } from '../../controllers/ConversionController'
import { createMockLogger, MockLogger } from '../setup/mockFactories'

describe('ConversionController.triggerBrlConversions', () => {
  let logger: MockLogger
  let dbProvider: IDatabaseClientProvider
  let exchangeProviderFactory: IExchangeProviderFactory
  let exchangeProvider: IExchangeProvider
  let badRequest: jest.Mock

  const pendingFindUnique = jest.fn()
  const pendingUpdate = jest.fn()
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<{ success: boolean }>) => {
    return fn({
      pendingConversions: {
        findUnique: pendingFindUnique,
        update: pendingUpdate,
      },
    })
  })

  const prismaClient = {
    $transaction: transaction,
    pendingConversions: {
      findUnique: pendingFindUnique,
      update: pendingUpdate,
    },
  }

  beforeEach(() => {
    logger = createMockLogger()

    exchangeProvider = {
      createMarketOrder: jest.fn(),
      exchangePercentageFee: 0.01,
      getExchangeAddress: jest.fn(),
      getExchangeRate: jest.fn(),
    }

    exchangeProviderFactory = {
      getExchangeProvider: jest.fn(() => exchangeProvider),
    }

    dbProvider = {
      getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
    }

    badRequest = jest.fn((status: number, payload: { reason: string }) => ({ status, ...payload }))

    jest.clearAllMocks()
  })

  it('returns a bad request when the payload is invalid', async () => {
    const controller = new ConversionController(logger, dbProvider, exchangeProviderFactory)

    const response = await controller.triggerBrlConversions({}, {} as Request, badRequest)

    expect(logger.warn).toHaveBeenCalledWith(
      'Invalid Transfero webhook payload',
      expect.objectContaining({ errors: expect.any(String) }),
    )
    expect(response).toEqual({ reason: 'Invalid webhook payload', status: 400 })
  })

  it('returns early when there are no pending conversions', async () => {
    pendingFindUnique.mockResolvedValueOnce(null)
    const controller = new ConversionController(logger, dbProvider, exchangeProviderFactory)

    const response = await controller.triggerBrlConversions({ amount: 10 }, {} as Request, badRequest)

    expect(response).toEqual({ converted_amount: 0, estimated_fiat_amount: 0, message: 'No pending BRL conversions', success: true })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('propagates exchange failures from the transaction', async () => {
    pendingFindUnique
      .mockResolvedValueOnce({ amount: 100, source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL })
      .mockResolvedValueOnce({ amount: 100, source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL })
    ;(exchangeProvider.createMarketOrder as jest.Mock).mockResolvedValue({ success: false })

    const controller = new ConversionController(logger, dbProvider, exchangeProviderFactory)

    const response = await controller.triggerBrlConversions({ amount: 50 }, {} as Request, badRequest)

    expect(response).toEqual({ success: false })
    expect(pendingUpdate).not.toHaveBeenCalled()
  })

  it('decrements pending conversions when processing succeeds', async () => {
    pendingFindUnique
      .mockResolvedValueOnce({ amount: 80, source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL })
      .mockResolvedValueOnce({ amount: 80, source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL })
    ;(exchangeProvider.createMarketOrder as jest.Mock).mockResolvedValue({ success: true })

    const controller = new ConversionController(logger, dbProvider, exchangeProviderFactory)

    const response = await controller.triggerBrlConversions({ amount: 30 }, {} as Request, badRequest)

    expect(response).toEqual({ success: true })
    expect(pendingUpdate).toHaveBeenCalledWith({
      data: { amount: { decrement: 30 } },
      where: { source_target: { source: SupportedCurrency.USDC, target: SupportedCurrency.BRL } },
    })
  })

  it('returns a 400 when an unexpected error occurs', async () => {
    const error = new Error('database offline')
    dbProvider = {
      getClient: jest.fn(async () => {
        throw error
      }),
    }
    const controller = new ConversionController(logger, dbProvider, exchangeProviderFactory)

    const response = await controller.triggerBrlConversions({ amount: 5 }, {} as Request, badRequest)

    expect(logger.error).toHaveBeenCalledWith('[ConversionController]: Error triggering BRL conversions', error)
    expect(response).toEqual({ reason: 'database offline', status: 400 })
  })
})
