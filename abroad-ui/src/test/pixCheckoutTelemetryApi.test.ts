import { vi } from 'vitest'

import type { PixCheckoutTelemetryRequest } from '../services/public/publicApi'

import { sendPixCheckoutTelemetry } from '../services/public/publicApi'

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
})
