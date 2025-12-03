import type { ILogger, IQueueHandler } from '../../interfaces'

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
  const postMessage: jest.MockedFunction<IQueueHandler['postMessage']> = jest.fn(
    async (_queueName, _message) => undefined,
  )
  const subscribeToQueue: jest.MockedFunction<IQueueHandler['subscribeToQueue']> = jest.fn(
    async (_queueName, _callback) => undefined,
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
