import 'reflect-metadata'

import { PixCheckoutTelemetryRequest } from '../../../../../modules/telemetry/interfaces/http/pixCheckoutTelemetryContracts'
import { PIX_CHECKOUT_TELEMETRY_LOG_MESSAGE, PixCheckoutTelemetryController } from '../../../../../modules/telemetry/interfaces/http/PixCheckoutTelemetryController'
import { createMockLogger, createResponder, MockLogger } from '../../../../setup/mockFactories'

const validEvent: PixCheckoutTelemetryRequest = {
  blockchain: 'STELLAR',
  chainFamily: 'stellar',
  entryPoint: 'manual',
  eventName: 'gate_blocked',
  gate: 'cpf_missing',
  rail: 'PIX',
  schemaVersion: 1,
  sourceAsset: 'USDC',
  targetCurrency: 'BRL',
  walletSurface: 'web',
}

describe('PixCheckoutTelemetryController', () => {
  let controller: PixCheckoutTelemetryController
  let logger: MockLogger

  beforeEach(() => {
    logger = createMockLogger()
    controller = new PixCheckoutTelemetryController(logger)
  })

  it('writes an allowlisted event as one structured Cloud Logging payload', async () => {
    const badRequest = createResponder<400, { reason: string }>()

    await expect(controller.record(validEvent, badRequest)).resolves.toEqual({
      accepted: true,
    })

    expect(controller.getStatus()).toBe(202)
    expect(badRequest).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      PIX_CHECKOUT_TELEMETRY_LOG_MESSAGE,
      validEvent,
    )
  })

  it.each([
    {
      description: 'an unknown field',
      event: { ...validEvent, pixKey: 'must-never-be-accepted' },
    },
    {
      description: 'a missing gate',
      event: { ...validEvent, gate: undefined },
    },
    {
      description: 'a gate on another event',
      event: { ...validEvent, eventName: 'quote_ready' },
    },
    {
      description: 'a missing rejection status class',
      event: {
        ...validEvent,
        eventName: 'submission_rejected',
        gate: undefined,
      },
    },
    {
      description: 'a rejection status class on another event',
      event: {
        ...validEvent,
        eventName: 'submission_started',
        gate: undefined,
        statusClass: 'network_error',
      },
    },
  ])('rejects $description without logging it', async ({ event }) => {
    const badRequest = createResponder<400, { reason: string }>()

    await expect(controller.record(
      event as unknown as PixCheckoutTelemetryRequest,
      badRequest,
    )).resolves.toEqual({ reason: 'Invalid telemetry event' })

    expect(badRequest).toHaveBeenCalledWith(400, {
      reason: 'Invalid telemetry event',
    })
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('accepts a classified submission rejection without a gate', async () => {
    const badRequest = createResponder<400, { reason: string }>()
    const rejectedEvent: PixCheckoutTelemetryRequest = {
      ...validEvent,
      eventName: 'submission_rejected',
      gate: undefined,
      statusClass: 'server_error',
    }

    await expect(controller.record(rejectedEvent, badRequest)).resolves.toEqual({
      accepted: true,
    })

    expect(logger.info).toHaveBeenCalledWith(
      PIX_CHECKOUT_TELEMETRY_LOG_MESSAGE,
      rejectedEvent,
    )
  })
})
