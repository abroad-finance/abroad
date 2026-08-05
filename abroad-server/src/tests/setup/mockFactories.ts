import { PaymentMethod, TargetCurrency } from '@prisma/client'

import type { ILogger } from '../../core/logging/types'
import type { IFiatDepositService } from '../../modules/payments/application/contracts/IFiatDepositService'
import type { IFiatDepositServiceFactory } from '../../modules/payments/application/contracts/IFiatDepositServiceFactory'
import type { CryptoInventoryService } from '../../modules/treasury/application/CryptoInventoryService'
import type { IQueueHandler } from '../../platform/messaging/queues'

export type MockLogger = jest.Mocked<ILogger>

export const createMockLogger = (overrides?: Partial<MockLogger>): MockLogger => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  ...overrides,
})

/**
 * Onramp collaborators for services that only exercise the payout direction.
 * Defaults are permissive so a payout test never has to reason about them; an
 * onramp test overrides the piece it is actually asserting on.
 */
export const createMockFiatDepositService = (
  overrides?: Partial<IFiatDepositService>,
): jest.Mocked<IFiatDepositService> => ({
  capability: { method: PaymentMethod.PIX, targetCurrency: TargetCurrency.BRL },
  createDeposit: jest.fn(async () => ({
    brCode: '00020126BRCODE',
    expiresAt: null,
    providerDepositId: 'deposit-1',
    success: true as const,
  })),
  currency: TargetCurrency.BRL,
  getDepositFacts: jest.fn(async () => ({ reason: 'not_stubbed', success: false as const })),
  isEnabled: true,
  MAX_USER_AMOUNT_PER_TRANSACTION: Number.POSITIVE_INFINITY,
  MIN_USER_AMOUNT_PER_TRANSACTION: 1,
  provider: 'transfero',
  refundDeposit: jest.fn(async () => ({ reason: 'not_stubbed', success: false as const })),
  ...overrides,
} as jest.Mocked<IFiatDepositService>)

export const createMockFiatDepositServiceFactory = (
  service = createMockFiatDepositService(),
): jest.Mocked<IFiatDepositServiceFactory> => ({
  getForCapability: jest.fn(
    (params: Parameters<IFiatDepositServiceFactory['getForCapability']>[0]) => {
      void params
      return service
    },
  ),
})

export const createMockCryptoInventoryService = (
  available = Number.MAX_SAFE_INTEGER,
): jest.Mocked<Pick<CryptoInventoryService, 'getAvailable'>> => ({
  getAvailable: jest.fn(
    async (params: Parameters<CryptoInventoryService['getAvailable']>[0]) => {
      void params
      return { available, success: true as const }
    },
  ),
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
  const deleteSubscription: NonNullable<IQueueHandler['deleteSubscription']> = jest.fn(
    async () => undefined,
  )

  return {
    closeAllSubscriptions,
    deleteSubscription,
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
