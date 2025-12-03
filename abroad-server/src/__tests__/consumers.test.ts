import type { IQueueHandler } from '../interfaces'

import { startConsumers, stopConsumers } from '../consumers'
import { TYPES } from '../types'

const receivedController = { registerConsumers: jest.fn() }
const paymentController = { registerConsumers: jest.fn() }
const paymentStatusController = { registerConsumers: jest.fn() }
const binanceController = { registerConsumers: jest.fn() }
const queueHandler: IQueueHandler = {
  closeAllSubscriptions: jest.fn(async () => undefined),
  postMessage: jest.fn(),
  subscribeToQueue: jest.fn(),
}

const getMock = jest.fn()

jest.mock('../ioc', () => ({
  iocContainer: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

describe('consumers lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
