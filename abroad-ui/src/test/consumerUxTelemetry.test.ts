import { vi } from 'vitest'

import {
  bucketCount,
  bucketElapsedMilliseconds,
  bucketLatencyMilliseconds,
  buildConsumerUxTelemetryPayload,
  createTelemetrySessionKey,
  getAppTelemetrySessionKey,
  getCheckoutTelemetrySessionKey,
  recordConsumerUxEvent,
  resetConsumerUxTelemetryDedupeForTests,
  resolveDeviceClass,
  rotateCheckoutTelemetrySessionKey,
} from '../observability/consumerUxTelemetry'

const sendConsumerUxTelemetryMock = vi.hoisted(() => vi.fn())

vi.mock('../services/public/publicApi', () => ({
  sendConsumerUxTelemetry: sendConsumerUxTelemetryMock,
}))

describe('consumer UX telemetry', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetConsumerUxTelemetryDedupeForTests()
  })

  it('creates opaque UUID keys unrelated to customer or transaction data', () => {
    const first = createTelemetrySessionKey()
    const second = createTelemetrySessionKey()

    expect(first).toMatch(/^[0-9a-f-]{36}$/i)
    expect(second).toMatch(/^[0-9a-f-]{36}$/i)
    expect(first).not.toBe(second)
  })

  it('keeps purpose-specific app and checkout keys stable and rotates a new draft', () => {
    const appKey = getAppTelemetrySessionKey()
    const checkoutKey = getCheckoutTelemetrySessionKey()

    expect(appKey).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getAppTelemetrySessionKey()).toBe(appKey)
    expect(checkoutKey).toMatch(/^[0-9a-f-]{36}$/i)
    expect(getCheckoutTelemetrySessionKey()).toBe(checkoutKey)
    expect(rotateCheckoutTelemetrySessionKey()).not.toBe(checkoutKey)
    expect(getCheckoutTelemetrySessionKey()).not.toBe(checkoutKey)
  })

  it('builds a schema-v2 event from bounded dimensions only', () => {
    const payload = buildConsumerUxTelemetryPayload({
      dimensions: {
        initial_destination: 'BRAZIL_PIX_BRL',
        source_surface: 'home',
      },
      name: 'destination_control_viewed',
      session: {
        key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
        kind: 'checkout',
      },
    }, '6ba7b811-9dad-41d1-80b4-00c04fd430c8')

    expect(payload).toMatchObject({
      checkout_attempt_key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
      event_key: '6ba7b811-9dad-41d1-80b4-00c04fd430c8',
      event_name: 'destination_control_viewed',
      initial_destination: 'BRAZIL_PIX_BRL',
      schema_version: 2,
      source_surface: 'home',
      // Resolves to the Sentry release in CI and 'development' locally, so
      // assert against the build constant rather than either literal.
      ui_version: __ABROAD_UI_VERSION__,
    })
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining([
      'account_number',
      'amount',
      'document_metadata',
      'filename',
      'pix_key',
      'qr_code',
      'tax_id',
      'transaction_id',
      'user_id',
      'wallet_address',
    ]))
  })

  it('coarsens device, elapsed, latency, and count values', () => {
    expect(resolveDeviceClass(390)).toBe('mobile')
    expect(resolveDeviceClass(800)).toBe('tablet')
    expect(resolveDeviceClass(1440)).toBe('desktop')
    expect(bucketElapsedMilliseconds(60_000)).toBe('60_to_120_seconds')
    expect(bucketLatencyMilliseconds(999)).toBe('250_to_1000_ms')
    expect(bucketCount(72)).toBe('fifty_one_to_one_hundred')
    expect(bucketCount(500)).toBe('over_one_hundred')
  })

  it('deduplicates once-per-transition events and remains fail-open', async () => {
    sendConsumerUxTelemetryMock.mockRejectedValue(new Error('logging unavailable'))
    const event = {
      name: 'activity_opened',
      session: {
        key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
        kind: 'activity',
      },
    } as const

    expect(() => {
      recordConsumerUxEvent(event, { onceKey: 'activity:opened' })
      recordConsumerUxEvent(event, { onceKey: 'activity:opened' })
    }).not.toThrow()
    await Promise.resolve()

    expect(sendConsumerUxTelemetryMock).toHaveBeenCalledTimes(1)
  })
})
