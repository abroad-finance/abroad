import { Partner } from '@prisma/client'
import { Request } from 'express'

import type { ClientDomain } from '../../modules/partners/domain/clientDomain'

import { IPartnerService } from '../../modules/partners/application/contracts/IPartnerService'
import { parseClientDomain } from '../../modules/partners/domain/clientDomain'
import { iocContainer } from '../container'
import { TYPES } from '../container/types'
import { OpsAuthService } from './OpsAuthService'

type AuthContext = Partner | { kind: 'ops' }

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
      return partnerService.getPartnerFromApiKey(apiKey)
    }

    const clientDomain = resolveClientDomain(request)
    if (clientDomain) {
      return partnerService.getPartnerFromClientDomain(clientDomain)
    }

    throw new Error('API key not provided')
  }

  if (securityName === 'BearerAuth') {
    const token = resolveBearerToken(request.headers.authorization)
    if (!token) {
      throw new Error('No token provided')
    }

    try {
      return await partnerService.getPartnerFromSepJwt(token)
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
