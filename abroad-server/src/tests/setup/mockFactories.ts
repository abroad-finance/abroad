import type { ILogger } from '../../core/logging/types'
import type { IQueueHandler } from '../../platform/messaging/queues'

export type MockLogger = jest.Mocked<ILogger>

export const createMockLogger = (overrides?: Partial<MockLogger>): MockLogger => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  ...overrides,
})

export type MockQueueHandler = jest.Mocked<IQueueHandler>

export const createMockQueueHandler = (
  overrides?: Partial<MockQueueHandler>,
): MockQueueHandler => {
  const postMessage: MockQueueHandler['postMessage'] = jest.fn(
    async (queueName, message) => {
      void queueName
      void message
    },
  )
  const subscribeToQueue: MockQueueHandler['subscribeToQueue'] = jest.fn(
    async (queueName, callback, customSubscriptionName) => {
      void queueName
      void callback
      void customSubscriptionName
    },
  )
  const closeAllSubscriptions: NonNullable<IQueueHandler['closeAllSubscriptions']> = jest.fn(
    async () => undefined,
  )

  return {
    closeAllSubscriptions,
    postMessage,
    subscribeToQueue,
    ...overrides,
  }
}

export type Responder<Status extends number, Body> = jest.Mock<Body, [Status, Body]>

export const createResponder = <Status extends number, Body>(): Responder<Status, Body> => (
  jest.fn((_status: Status, payload: Body) => payload)
)

describe('mockFactories helpers', () => {
  it('exposes logger and queue factory helpers', () => {
    const logger = createMockLogger()
    const queue = createMockQueueHandler()

    expect(logger.info).toBeDefined()
    expect(queue.postMessage).toBeDefined()
  })
})
