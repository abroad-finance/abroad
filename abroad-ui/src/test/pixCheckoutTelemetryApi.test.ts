import { vi } from 'vitest'

import type { PixCheckoutTelemetryRequest } from '../services/public/publicApi'

import { sendConsumerUxTelemetry, sendPixCheckoutTelemetry } from '../services/public/publicApi'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('../services/http/httpClient', () => ({
  httpClient: {
    request: requestMock,
  },
}))

const telemetryEvent: PixCheckoutTelemetryRequest = {
  blockchain: 'CELO',
  chainFamily: 'evm',
  entryPoint: 'qr',
  eventName: 'submission_rejected',
  rail: 'PIX',
  schemaVersion: 1,
  sourceAsset: 'USDT',
  statusClass: 'client_error',
  targetCurrency: 'BRL',
  walletSurface: 'minipay',
}

describe('PIX checkout telemetry API', () => {
  it('posts the bounded event to Abroad with keepalive enabled', async () => {
    requestMock.mockResolvedValueOnce({
      data: { accepted: true },
      headers: new Headers(),
      ok: true,
      status: 202,
    })

    await expect(sendPixCheckoutTelemetry(telemetryEvent)).resolves.toMatchObject({
      data: { accepted: true },
      ok: true,
      status: 202,
    })

    expect(requestMock).toHaveBeenCalledWith('/telemetry/pix-checkout', {
      body: JSON.stringify(telemetryEvent),
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    })
  })

  it('posts schema-v2 consumer events through the additive endpoint', async () => {
    requestMock.mockResolvedValueOnce({
      data: { accepted: true },
      headers: new Headers(),
      ok: true,
      status: 202,
    })

    const event = {
      activity_session_key: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
      device_class: 'desktop',
      event_key: '6ba7b811-9dad-41d1-80b4-00c04fd430c8',
      event_name: 'activity_opened',
      schema_version: 2,
      ui_version: 'development',
    } as const
    await sendConsumerUxTelemetry(event)

    expect(requestMock).toHaveBeenCalledWith('/telemetry/consumer-ux', {
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    })
  })
})
