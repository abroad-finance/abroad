import { createHealthHandler, startConsumers, stopConsumers } from '../consumers'
import { TYPES } from '../types'
import { createMockQueueHandler, MockQueueHandler } from './setup/mockFactories'
import { createResponseRecorder, mockProcessExit, toIncomingMessage, toServerResponse } from './setup/testHarness'

const receivedController = { registerConsumers: jest.fn() }
const paymentController = { registerConsumers: jest.fn() }
const paymentStatusController = { registerConsumers: jest.fn() }
const binanceController = { registerConsumers: jest.fn() }
let queueHandler: MockQueueHandler

const getMock = jest.fn()

jest.mock('../ioc', () => ({
  iocContainer: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

describe('consumers lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queueHandler = createMockQueueHandler()
    getMock.mockImplementation((token: unknown) => {
      switch (token) {
        case TYPES.BinanceBalanceUpdatedController:
          return binanceController
        case TYPES.IQueueHandler:
          return queueHandler
        case TYPES.PaymentSentController:
          return paymentController
        case TYPES.PaymentStatusUpdatedController:
          return paymentStatusController
        case TYPES.ReceivedCryptoTransactionController:
          return receivedController
        default:
          return {}
      }
    })
  })

  it('starts and stops all consumers', async () => {
    startConsumers()

    expect(receivedController.registerConsumers).toHaveBeenCalled()
    expect(paymentController.registerConsumers).toHaveBeenCalled()
    expect(paymentStatusController.registerConsumers).toHaveBeenCalled()
    expect(binanceController.registerConsumers).toHaveBeenCalled()

    await stopConsumers()
    expect(queueHandler.closeAllSubscriptions).toHaveBeenCalled()
  })
})

describe('consumers entrypoint health server', () => {
  beforeEach(() => {
    getMock.mockImplementation((token: unknown) => {
      switch (token) {
        case TYPES.BinanceBalanceUpdatedController:
          return binanceController
        case TYPES.IQueueHandler:
          return queueHandler
        case TYPES.PaymentSentController:
          return paymentController
        case TYPES.PaymentStatusUpdatedController:
          return paymentStatusController
        case TYPES.ReceivedCryptoTransactionController:
          return receivedController
        default:
          return {}
      }
    })
  })

  it('exposes health/readiness endpoints and handles shutdown signals', async () => {
    const state = { live: true, ready: true }
    const recordedHandler = createHealthHandler(state)

    expect(recordedHandler).toBeDefined()

    const { body: liveChunks, res: liveRes } = createResponseRecorder<string>()
    recordedHandler(toIncomingMessage({ url: '/healthz' }), toServerResponse(liveRes))
    expect(liveRes.statusCode).toBe(200)
    expect(liveChunks.join('')).toBe('ok')

    const { body: readyChunks, res: readyRes } = createResponseRecorder<string>()
    recordedHandler(toIncomingMessage({ url: '/readyz' }), toServerResponse(readyRes))
    expect(readyRes.statusCode).toBe(200)
    expect(readyChunks.join('')).toBe('ready')

    const exitSpy = mockProcessExit()
    state.ready = false
    await stopConsumers()

    const { body: readyAfterChunks, res: readyAfterRes } = createResponseRecorder<string>()
    recordedHandler(toIncomingMessage({ url: '/readyz' }), toServerResponse(readyAfterRes))
    expect(readyAfterRes.statusCode).toBe(503)
    expect(readyAfterChunks.join('')).toBe('not ready')
    exitSpy.restore()
  })
})
