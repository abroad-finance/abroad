import { TYPES } from '../../../../app/container/types'
import { createHealthHandler, startConsumers, stopConsumers } from '../../../../app/workers/consumers/server'
import { createMockQueueHandler, MockQueueHandler } from '../../../setup/mockFactories'
import { createResponseRecorder, mockProcessExit, toIncomingMessage, toServerResponse } from '../../../setup/testHarness'

const receivedController = { registerConsumers: jest.fn() }
const paymentStatusController = { registerConsumers: jest.fn() }
const binanceController = { registerConsumers: jest.fn() }
const deadLetterController = { registerConsumers: jest.fn() }
let queueHandler: MockQueueHandler

jest.mock('../../../../app/container', () => {
  const mockGet = jest.fn()
  return {
    __mockGet: mockGet,
    iocContainer: {
      get: (...args: unknown[]) => mockGet(...args),
    },
  }
})
const { __mockGet: getMock } = jest.requireMock('../../../../app/container') as { __mockGet: jest.Mock }

describe('consumers lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    queueHandler = createMockQueueHandler()
    getMock.mockReset()
    getMock.mockImplementation((token: unknown) => {
      switch (token) {
        case TYPES.BinanceBalanceUpdatedController:
          return binanceController
        case TYPES.DeadLetterController:
          return deadLetterController
        case TYPES.IQueueHandler:
          return queueHandler
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
    expect(paymentStatusController.registerConsumers).toHaveBeenCalled()
    expect(binanceController.registerConsumers).toHaveBeenCalled()
    expect(deadLetterController.registerConsumers).toHaveBeenCalled()

    await stopConsumers()
    expect(queueHandler.closeAllSubscriptions).toHaveBeenCalled()
  })

  it('stops gracefully when the queue handler cannot close subscriptions', async () => {
    queueHandler = createMockQueueHandler({
      closeAllSubscriptions: undefined as unknown as MockQueueHandler['closeAllSubscriptions'],
    })
    getMock.mockImplementation((token: unknown) => {
      switch (token) {
        case TYPES.BinanceBalanceUpdatedController:
          return binanceController
        case TYPES.IQueueHandler:
          return queueHandler
        case TYPES.PaymentStatusUpdatedController:
          return paymentStatusController
        case TYPES.ReceivedCryptoTransactionController:
          return receivedController
        default:
          return {}
      }
    })

    await expect(stopConsumers()).resolves.not.toThrow()
  })
})

describe('consumers entrypoint health server', () => {
  beforeEach(() => {
    queueHandler = createMockQueueHandler()
    getMock.mockImplementation((token: unknown) => {
      switch (token) {
        case TYPES.BinanceBalanceUpdatedController:
          return binanceController
        case TYPES.DeadLetterController:
          return deadLetterController
        case TYPES.IQueueHandler:
          return queueHandler
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

    const { body: unknownChunks, res: unknownRes } = createResponseRecorder<string>()
    recordedHandler(toIncomingMessage({ url: '/missing' }), toServerResponse(unknownRes))
    expect(unknownRes.statusCode).toBe(404)
    expect(unknownChunks.join('')).toBe('not found')

    const { body: defaultChunks, res: defaultRes } = createResponseRecorder<string>()
    recordedHandler(toIncomingMessage({}), toServerResponse(defaultRes))
    expect(defaultRes.statusCode).toBe(200)
    expect(defaultChunks.join('')).toBe('ok')
    exitSpy.restore()
  })
})
