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

jest.mock('../../listeners/stellar', () => ({
  StellarListener: jest.fn(() => ({
    start: stellarStartMock,
    stop: stellarStopMock,
  })),
}))

jest.mock('../../listeners/binance', () => ({
  BinanceListener: jest.fn(() => ({
    start: binanceStartMock,
  })),
}))

jest.mock('../../ioc', () => {
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

import { startListeners } from '../../listeners/index'

describe('startListeners', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    stellarStartMock.mockResolvedValue(undefined)
    stellarStopMock.mockResolvedValue(undefined)
    binanceStartMock.mockResolvedValue(undefined)
    getMock.mockImplementation((key: string) => {
      if (key === 'StellarListener') return { start: stellarStartMock, stop: stellarStopMock }
      if (key === 'BinanceListener') return { start: binanceStartMock }
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
