import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '.prisma/client'

import { PaymentSentMessageSchema, PaymentStatusUpdatedMessageSchema, UserNotificationMessageSchema } from '../../platform/messaging/queueSchema'

describe('queue schema validation', () => {
  it('accepts valid payment sent and status update messages', () => {
    expect(() => PaymentSentMessageSchema.parse({
      amount: 25,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      paymentMethod: PaymentMethod.NEQUI,
      targetCurrency: TargetCurrency.COP,
    })).not.toThrow()

    expect(() => PaymentStatusUpdatedMessageSchema.parse({
      currency: TargetCurrency.COP,
      externalId: 'ext-123',
      status: 'Processing',
    })).not.toThrow()
  })

  it('requires a user identifier for websocket notifications', () => {
    expect(() => UserNotificationMessageSchema.parse({
      payload: { foo: 'bar' },
      type: 'event',
    })).toThrow(/userId or id must be provided/)

    const parsed = UserNotificationMessageSchema.parse({
      id: 'user-123',
      payload: 'ok',
      type: 'event',
    })

    expect(parsed.id).toBe('user-123')

    const complexPayload = UserNotificationMessageSchema.parse({
      id: 'user-123',
      payload: { nested: [1, true, null] },
      type: 'event',
    })

    expect(complexPayload.payload).toEqual({ nested: [1, true, null] })
    expect(() => UserNotificationMessageSchema.parse({
      id: 'user-123',
      payload: (() => 'not-serializable') as unknown as never,
      type: 'event',
    })).toThrow()
  })
})
