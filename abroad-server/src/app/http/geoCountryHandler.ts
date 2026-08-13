import type { Request, RequestHandler, Response } from 'express'

import geoip from 'geoip-lite'

import type { GeoRestrictionService } from '../../modules/operations/application/GeoRestrictionService'

// Geo lookup used by the UI to gate access from restricted regions.
//
// Reads the client IP from X-Forwarded-For (the load balancer / Cloud Run
// frontend prepends the original client IP) and falls back to the socket
// address. Returns the resolved country and a `blocked` boolean; the UI is
// responsible for the redirect / 451 page. An unresolved IP is never blocked,
// so the gate fails open on lookup errors.
//
// Whether a restricted country is actually refused is Ops-controlled state, not
// a constant, so the decision is delegated to GeoRestrictionService.
export const createGeoCountryHandler = (
  geoRestrictionService: GeoRestrictionService,
): RequestHandler => async (request: Request, response: Response): Promise<void> => {
  const forwardedFor = request.header('x-forwarded-for')
  const ip = (forwardedFor?.split(',')[0]?.trim()) || request.socket.remoteAddress || ''
  const lookup = ip ? geoip.lookup(ip) : null
  const country = lookup?.country ?? null
  const blocked = await geoRestrictionService.isCountryBlocked(country)
  response.set('Cache-Control', 'private, no-store')
  response.status(200).json({ blocked, country })
}
