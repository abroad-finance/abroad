import type { Container } from 'inversify'

import { TYPES } from '../../../../../app/container/types'

describe('listeners/index', () => {
  const stellar = { start: jest.fn(), stop: jest.fn() }
  const binance = { start: jest.fn() }
  const bind = jest.fn()
  const get = jest.fn()
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const mockContainer = { bind, get } as unknown as Container

  const setupModule = async () => {
    bind.mockImplementation(() => ({
      inSingletonScope: jest.fn(),
      to: jest.fn().mockReturnThis(),
    }))
    get.mockImplementation((identifier: unknown) => {
      if (identifier === TYPES.StellarListener || identifier === 'StellarListener') return stellar
      if (identifier === 'BinanceListener') return binance
      if (identifier === TYPES.ILogger) return logger
      throw new Error(`Unknown identifier ${String(identifier)}`)
    })

    jest.doMock('../../../../../app/container', () => ({ __esModule: true, iocContainer: mockContainer }))
    jest.doMock('../../../../../modules/treasury/interfaces/listeners/StellarListener', () => ({ __esModule: true, StellarListener: class { public start = stellar.start; public stop = stellar.stop } }))
    jest.doMock('../../../../../modules/treasury/interfaces/listeners/BinanceListener', () => ({ __esModule: true, BinanceListener: class { public start = binance.start } }))

    return import('../../../../../modules/treasury/interfaces/listeners')
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    stellar.start.mockResolvedValue(undefined)
    binance.start.mockResolvedValue(undefined)
  })

  it('starts stellar and binance listeners successfully', async () => {
    const listeners = await setupModule()
    listeners.startListeners()

    expect(bind).toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith(TYPES.StellarListener)
    expect(get).toHaveBeenCalledWith('BinanceListener')
    expect(stellar.start).toHaveBeenCalled()
    expect(binance.start).toHaveBeenCalled()
  })

  it('logs errors when stellar listener fails to start', async () => {
    const error = new Error('failure')
    stellar.start.mockRejectedValueOnce(error)
    const listeners = await setupModule()

    listeners.startListeners()
    await new Promise(resolve => setImmediate(resolve))

    expect(logger.error).toHaveBeenCalledWith('[listeners] Error starting StellarListener:', error)
  })
})
