import 'reflect-metadata'

import type { NextFunction, Request, Response } from 'express'

import type { GeoRestrictionService } from '../../../modules/operations/application/GeoRestrictionService'

import { createGeoCountryHandler } from '../../../app/http/geoCountryHandler'

const lookup = jest.fn()

jest.mock('geoip-lite', () => ({
  __esModule: true,
  default: { lookup: (ip: string) => lookup(ip) },
}))

type CapturedResponse = {
  body: unknown
  headers: Record<string, string>
  status: null | number
}

const buildRequest = (options: {
  forwardedFor?: string
  remoteAddress?: string
}): Request => ({
  header: (name: string) => (
    name.toLowerCase() === 'x-forwarded-for' ? options.forwardedFor : undefined
  ),
  socket: { remoteAddress: options.remoteAddress },
} as unknown as Request)

const buildResponse = (): { captured: CapturedResponse, response: Response } => {
  const captured: CapturedResponse = { body: undefined, headers: {}, status: null }
  const response = {
    json: (body: unknown) => {
      captured.body = body
      return response
    },
    set: (name: string, value: string) => {
      captured.headers[name] = value
      return response
    },
    status: (code: number) => {
      captured.status = code
      return response
    },
  } as unknown as Response
  return { captured, response }
}

const buildService = (blocked: boolean) => {
  const isCountryBlocked = jest.fn(async () => blocked)
  return {
    isCountryBlocked,
    service: { isCountryBlocked } as unknown as GeoRestrictionService,
  }
}

const invoke = async (
  handlerService: GeoRestrictionService,
  request: Request,
): Promise<CapturedResponse> => {
  const { captured, response } = buildResponse()
  await createGeoCountryHandler(handlerService)(request, response, (() => {}) as NextFunction)
  return captured
}

beforeEach(() => {
  lookup.mockReset()
})

describe('geo country handler', () => {
  it('reports a restricted country as blocked while the gate is enforced', async () => {
    lookup.mockReturnValue({ country: 'US' })
    const { isCountryBlocked, service } = buildService(true)

    const captured = await invoke(service, buildRequest({ forwardedFor: '203.0.113.7' }))

    expect(isCountryBlocked).toHaveBeenCalledWith('US')
    expect(captured.status).toBe(200)
    expect(captured.body).toEqual({ blocked: true, country: 'US' })
  })

  it('still reports the country but stops blocking once the gate is lifted', async () => {
    lookup.mockReturnValue({ country: 'US' })
    const { service } = buildService(false)

    const captured = await invoke(service, buildRequest({ forwardedFor: '203.0.113.7' }))

    expect(captured.body).toEqual({ blocked: false, country: 'US' })
  })

  // An unresolved address is reported as no country and, per the service
  // contract exercised in GeoRestrictionService.test.ts, is never blocked.
  it('reports no country when the address does not resolve', async () => {
    lookup.mockReturnValue(null)
    const { isCountryBlocked, service } = buildService(false)

    const captured = await invoke(service, buildRequest({ forwardedFor: '203.0.113.7' }))

    expect(isCountryBlocked).toHaveBeenCalledWith(null)
    expect(captured.body).toEqual({ blocked: false, country: null })
  })

  it('uses the first forwarded hop and falls back to the socket address', async () => {
    lookup.mockReturnValue({ country: 'CO' })
    const { service } = buildService(false)

    await invoke(service, buildRequest({ forwardedFor: '203.0.113.7, 70.41.3.18' }))
    expect(lookup).toHaveBeenLastCalledWith('203.0.113.7')

    await invoke(service, buildRequest({ remoteAddress: '198.51.100.4' }))
    expect(lookup).toHaveBeenLastCalledWith('198.51.100.4')
  })

  it('skips the lookup entirely when no address is available', async () => {
    const { isCountryBlocked, service } = buildService(false)

    const captured = await invoke(service, buildRequest({}))

    expect(lookup).not.toHaveBeenCalled()
    expect(isCountryBlocked).toHaveBeenCalledWith(null)
    expect(captured.body).toEqual({ blocked: false, country: null })
  })

  it('keeps the per-visitor decision out of shared caches', async () => {
    lookup.mockReturnValue({ country: 'US' })
    const { service } = buildService(true)

    const captured = await invoke(service, buildRequest({ forwardedFor: '203.0.113.7' }))

    expect(captured.headers['Cache-Control']).toBe('private, no-store')
  })
})
