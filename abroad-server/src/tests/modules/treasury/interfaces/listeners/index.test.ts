const stellarStartMock = jest.fn()
const stellarStopMock = jest.fn()
const binanceStartMock = jest.fn()
let bindMock: jest.Mock
let getMock: jest.Mock
let containerMock: {
  bind: jest.Mock
  get: jest.Mock
  inSingletonScope: jest.Mock
  to: jest.Mock
}

jest.mock('../../../../../modules/treasury/interfaces/listeners/StellarListener', () => ({
  StellarListener: jest.fn(() => ({
    start: stellarStartMock,
    stop: stellarStopMock,
  })),
}))

jest.mock('../../../../../modules/treasury/interfaces/listeners/BinanceListener', () => ({
  BinanceListener: jest.fn(() => ({
    start: binanceStartMock,
  })),
}))

jest.mock('../../../../../app/container', () => {
  bindMock = jest.fn()
  getMock = jest.fn()
  const inSingletonScope = jest.fn()
  const to = jest.fn()
  containerMock = {
    bind: bindMock,
    get: getMock,
    inSingletonScope,
    to,
  }
  bindMock.mockReturnValue(containerMock)
  inSingletonScope.mockReturnValue(containerMock)
  to.mockReturnValue(containerMock)
  return { iocContainer: containerMock }
})

import { TYPES } from '../../../../../app/container/types'
import { startListeners } from '../../../../../modules/treasury/interfaces/listeners'

describe('startListeners', () => {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  beforeEach(() => {
    jest.clearAllMocks()
    stellarStartMock.mockResolvedValue(undefined)
    stellarStopMock.mockResolvedValue(undefined)
    binanceStartMock.mockResolvedValue(undefined)
    getMock.mockImplementation((key: unknown) => {
      if (key === 'StellarListener') return { start: stellarStartMock, stop: stellarStopMock }
      if (key === 'BinanceListener') return { start: binanceStartMock }
      if (key === TYPES.ILogger) return logger
      return {}
    })
  })

  it('binds and starts both Stellar and Binance listeners', () => {
    startListeners()

    expect(bindMock).toHaveBeenCalledWith('StellarListener')
    expect(bindMock).toHaveBeenCalledWith('BinanceListener')
    expect(getMock).toHaveBeenCalledWith('StellarListener')
    expect(getMock).toHaveBeenCalledWith('BinanceListener')
    expect(stellarStartMock).toHaveBeenCalled()
    expect(binanceStartMock).toHaveBeenCalled()
  })
})
