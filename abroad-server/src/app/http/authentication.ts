import { Request } from 'express'

import type { ClientDomain } from '../../modules/partners/domain/clientDomain'

import { AuthenticatedPartner, IPartnerService, PartnerAuthenticationSource } from '../../modules/partners/application/contracts/IPartnerService'
import { PartnerPortalSessionService } from '../../modules/partners/application/PartnerPortalSessionService'
import { parseClientDomain } from '../../modules/partners/domain/clientDomain'
import { iocContainer } from '../container'
import { TYPES } from '../container/types'
import { OpsAuthService } from './OpsAuthService'

type AuthContext = AuthenticatedPartner | { kind: 'ops' }

const CLIENT_DOMAIN_HEADER_CANDIDATES = ['Origin', 'Referer'] as const
const BEARER_PREFIX = 'Bearer '

const resolveClientDomain = (request: Request): ClientDomain | undefined => {
  for (const headerName of CLIENT_DOMAIN_HEADER_CANDIDATES) {
    const rawHeader = request.header(headerName)
    if (!rawHeader) {
      continue
    }

    const clientDomain = parseClientDomain(rawHeader)
    if (clientDomain) {
      return clientDomain
    }
  }

  return undefined
}

const resolveBearerToken = (authorizationHeader: string | undefined): null | string => {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    return null
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim()
  return token.length > 0 ? token : null
}

const withAuthenticationSource = (
  partner: Omit<AuthenticatedPartner, 'authenticationSource'>,
  authenticationSource: PartnerAuthenticationSource,
): AuthenticatedPartner => ({
  ...partner,
  authenticationSource,
})

export async function expressAuthentication(
  request: Request,
  securityName: string,
): Promise<AuthContext> {
  const partnerService = iocContainer.get<IPartnerService>(
    TYPES.IPartnerService,
  )

  if (securityName === 'ApiKeyAuth') {
    const apiKey = request.header('X-API-Key')
    if (apiKey) {
      const partner = await partnerService.getPartnerFromApiKey(apiKey)
      return withAuthenticationSource(partner, 'API_KEY')
    }

    if (resolveBearerToken(request.headers.authorization)) {
      // TSOA races the configured auth alternatives. An explicit Bearer token
      // must win over ambient Origin/Referer partner resolution so its signed
      // SEP provenance cannot be discarded nondeterministically.
      throw new Error('Bearer token takes precedence over client domain')
    }

    const clientDomain = resolveClientDomain(request)
    if (clientDomain) {
      const partner = await partnerService.getPartnerFromClientDomain(clientDomain)
      return withAuthenticationSource(partner, 'CLIENT_DOMAIN')
    }

    throw new Error('API key not provided')
  }

  if (securityName === 'PartnerPortalAuth') {
    const token = resolveBearerToken(request.headers.authorization)
    if (!token) {
      throw new Error('Partner portal token not provided')
    }

    try {
      const sessionService = iocContainer.get<PartnerPortalSessionService>(PartnerPortalSessionService)
      const partner = await sessionService.verifySession(token)
      return withAuthenticationSource(partner, 'PARTNER_PORTAL')
    }
    catch {
      throw new Error('Invalid partner portal token')
    }
  }

  if (securityName === 'BearerAuth') {
    if (request.header('X-API-Key')) {
      // Explicit API keys take precedence when both credentials are supplied.
      throw new Error('API key takes precedence over Bearer token')
    }

    const token = resolveBearerToken(request.headers.authorization)
    if (!token) {
      throw new Error('No token provided')
    }

    try {
      const authentication = await partnerService.authenticateBearerToken(token)
      return withAuthenticationSource(authentication.partner, authentication.source)
    }
    catch {
      throw new Error('Invalid token or partner not found')
    }
  }

  if (securityName === 'OpsApiKeyAuth') {
    const headerKey = request.header('X-OPS-API-KEY')
    if (!headerKey) {
      throw new Error('Ops API key not provided')
    }

    const opsAuthService = iocContainer.get<OpsAuthService>(TYPES.IOpsAuthService)
    let expected: string
    try {
      expected = await opsAuthService.getOpsApiKey()
    }
    catch {
      throw new Error('Ops API key not configured')
    }
    if (!expected || headerKey !== expected) {
      throw new Error('Invalid ops API key')
    }
    return { kind: 'ops' }
  }

  throw new Error('Invalid security scheme')
}
