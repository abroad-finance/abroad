import type { Container } from 'inversify'

describe('listeners/index', () => {
  const stellar = { start: jest.fn(), stop: jest.fn() }
  const binance = { start: jest.fn() }
  const bind = jest.fn()
  const get = jest.fn()
  const mockContainer = { bind, get } as unknown as Container

  const setupModule = async () => {
    bind.mockImplementation(() => ({
      inSingletonScope: jest.fn(),
      to: jest.fn().mockReturnThis(),
    }))
    get.mockImplementation((identifier: string) => {
      if (identifier === 'StellarListener') return stellar
      if (identifier === 'BinanceListener') return binance
      throw new Error(`Unknown identifier ${identifier}`)
    })

    jest.doMock('../../ioc', () => ({ __esModule: true, iocContainer: mockContainer }))
    jest.doMock('../../listeners/stellar', () => ({ __esModule: true, StellarListener: class { public start = stellar.start; public stop = stellar.stop } }))
    jest.doMock('../../listeners/binance', () => ({ __esModule: true, BinanceListener: class { public start = binance.start } }))

    return import('../../listeners/index')
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
    expect(get).toHaveBeenCalledWith('StellarListener')
    expect(stellar.start).toHaveBeenCalled()
    expect(binance.start).toHaveBeenCalled()
  })

  it('logs errors when stellar listener fails to start', async () => {
    const error = new Error('failure')
    stellar.start.mockRejectedValueOnce(error)
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const listeners = await setupModule()

    listeners.startListeners()
    await new Promise(resolve => setImmediate(resolve))

    expect(consoleSpy).toHaveBeenCalledWith('[listeners] Error starting StellarListener:', error)
  })
})
