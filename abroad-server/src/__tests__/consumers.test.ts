import { createHealthHandler, startConsumers, stopConsumers } from '../consumers'
import { TYPES } from '../types'
import { createMockQueueHandler, MockQueueHandler } from './setup/mockFactories'

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
  let recordedHandler: ((req: { url?: string }, res: { end: (chunk?: string) => void, setHeader: jest.Mock, statusCode: number }) => void) | undefined
  const listenMock = jest.fn((_port: number, cb?: () => void) => {
    cb?.()
  })

  beforeEach(() => {
    recordedHandler = undefined
    jest.resetModules()
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
    jest.doMock('http', () => ({
      createServer: (handler: typeof recordedHandler) => {
        recordedHandler = handler
        return {
          listen: listenMock,
        }
      },
    }))
  })

  it('exposes health/readiness endpoints and handles shutdown signals', async () => {
    const state = { live: true, ready: true }
    recordedHandler = createHealthHandler(state) as unknown as typeof recordedHandler

    expect(recordedHandler).toBeDefined()
    const respond = () => {
      const chunks: string[] = []
      const res = {
        end: (chunk?: string) => {
          if (chunk) chunks.push(chunk)
        },
        setHeader: jest.fn(),
        statusCode: 0,
      }
      return { chunks, res }
    }

    const { chunks: liveChunks, res: liveRes } = respond()
    recordedHandler?.({ url: '/healthz' }, liveRes)
    expect(liveRes.statusCode).toBe(200)
    expect(liveChunks.join('')).toBe('ok')

    const { chunks: readyChunks, res: readyRes } = respond()
    recordedHandler?.({ url: '/readyz' }, readyRes)
    expect(readyRes.statusCode).toBe(200)
    expect(readyChunks.join('')).toBe('ready')

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    state.ready = false
    await stopConsumers()

    const { chunks: readyAfterChunks, res: readyAfterRes } = respond()
    recordedHandler?.({ url: '/readyz' }, readyAfterRes)
    expect(readyAfterRes.statusCode).toBe(503)
    expect(readyAfterChunks.join('')).toBe('not ready')
    exitSpy.mockRestore()
  })
})
