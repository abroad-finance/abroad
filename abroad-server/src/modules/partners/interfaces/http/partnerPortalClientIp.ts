import type { Request as ExpressRequest } from 'express'

import { isIP } from 'node:net'

const UNKNOWN_CLIENT_IP = 'unavailable'

const normalizeIp = (candidate: string | undefined): null | string => {
  const normalized = candidate?.trim()
  return normalized && isIP(normalized) !== 0 ? normalized : null
}

export const readPartnerPortalClientIp = (request: ExpressRequest): string => {
  const forwardedFor = request.header('x-forwarded-for')
    ?.split(',')
    .map(candidate => normalizeIp(candidate))
    .filter((candidate): candidate is string => candidate !== null) ?? []

  // Google-managed ingress appends the client and proxy addresses. Selecting
  // the penultimate entry ignores any client-supplied prefix while retaining
  // the address inserted by the trusted edge.
  if (forwardedFor.length >= 2) {
    return forwardedFor[forwardedFor.length - 2]
  }
  return forwardedFor[0]
    ?? normalizeIp(request.socket.remoteAddress)
    ?? UNKNOWN_CLIENT_IP
}
