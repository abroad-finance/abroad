import 'reflect-metadata'

import type { ConsumerUxTelemetryRequest } from '../../../../../modules/telemetry/interfaces/http/consumerUxTelemetryContracts'

import { CONSUMER_UX_TELEMETRY_LOG_MESSAGE, ConsumerUxTelemetryController } from '../../../../../modules/telemetry/interfaces/http/ConsumerUxTelemetryController'
import { createMockLogger, createResponder, MockLogger } from '../../../../setup/mockFactories'

const validEvent: ConsumerUxTelemetryRequest = {
  checkout_attempt_key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
  device_class: 'mobile',
  event_key: '6ba7b811-9dad-41d1-80b4-00c04fd430c8',
  event_name: 'recipient_method_selected',
  method: 'pasted_qr',
  rail: 'PIX',
  schema_version: 2,
  step: 'payment_details',
  ui_version: '5.7.0-21dc14b',
}

describe('ConsumerUxTelemetryController', () => {
  let controller: ConsumerUxTelemetryController
  let logger: MockLogger

  beforeEach(() => {
    logger = createMockLogger()
    controller = new ConsumerUxTelemetryController(logger)
  })

  it('writes one bounded schema-v2 event to structured Cloud Logging', async () => {
    const badRequest = createResponder<400, { reason: string }>()

    await expect(controller.record(validEvent, badRequest)).resolves.toEqual({
      accepted: true,
    })

    expect(controller.getStatus()).toBe(202)
    expect(badRequest).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      CONSUMER_UX_TELEMETRY_LOG_MESSAGE,
      validEvent,
    )
  })

  it.each([
    ['an unknown field', { ...validEvent, pix_key: 'must-not-be-accepted' }],
    ['a non-random session key', { ...validEvent, checkout_attempt_key: 'wallet-derived-value' }],
    ['two purpose keys', {
      ...validEvent,
      activity_session_key: '6ba7b812-9dad-41d1-80b4-00c04fd430c8',
    }],
    ['the wrong purpose key', {
      ...validEvent,
      checkout_attempt_key: undefined,
      verification_session_key: '6ba7b812-9dad-41d1-80b4-00c04fd430c8',
    }],
    ['a free-form UI version', { ...validEvent, ui_version: 'release with customer text' }],
    ['an unbounded outcome', { ...validEvent, outcome: 'customer-specific outcome' }],
    ['a missing event-specific dimension', { ...validEvent, method: undefined }],
  ])('rejects %s without logging', async (_description, request) => {
    const badRequest = createResponder<400, { reason: string }>()

    await expect(controller.record(
      request as unknown as ConsumerUxTelemetryRequest,
      badRequest,
    )).resolves.toEqual({ reason: 'Invalid telemetry event' })

    expect(badRequest).toHaveBeenCalledWith(400, {
      reason: 'Invalid telemetry event',
    })
    expect(logger.info).not.toHaveBeenCalled()
  })

  it.each([
    {
      activity_session_key: '6ba7b813-9dad-41d1-80b4-00c04fd430c8',
      entry_surface: 'activity' as const,
      event_name: 'activity_opened' as const,
    },
    {
      elapsed_bucket: 'under_10_seconds' as const,
      event_name: 'verification_viewed' as const,
      step: 'about' as const,
      trigger_category: 'compliance_required' as const,
      verification_session_key: '6ba7b814-9dad-41d1-80b4-00c04fd430c8',
    },
    {
      app_session_key: '6ba7b815-9dad-41d1-80b4-00c04fd430c8',
      event_name: 'conditional_service_state_viewed' as const,
      state: 'connection_lost' as const,
    },
  ])('accepts the purpose-specific key for $event_name', async (purpose) => {
    const badRequest = createResponder<400, { reason: string }>()
    const request: ConsumerUxTelemetryRequest = {
      device_class: 'desktop',
      event_key: '6ba7b816-9dad-41d1-80b4-00c04fd430c8',
      schema_version: 2,
      ui_version: 'development',
      ...purpose,
    }

    await expect(controller.record(request, badRequest)).resolves.toEqual({
      accepted: true,
    })
    expect(badRequest).not.toHaveBeenCalled()
  })
})
