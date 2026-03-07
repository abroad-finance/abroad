// src/app/http/authentication.ts

import { Partner } from '@prisma/client'
import { Request } from 'express'

import { IPartnerService } from '../../modules/partners/application/contracts/IPartnerService'
import { iocContainer } from '../container'
import { TYPES } from '../container/types'
import { OpsAuthService } from './OpsAuthService'

type AuthContext = Partner | { kind: 'ops' }

const CLIENT_DOMAIN_HEADER_CANDIDATES = ['Origin', 'Referer'] as const

const resolveClientDomain = (request: Request): undefined | string => {
  for (const headerName of CLIENT_DOMAIN_HEADER_CANDIDATES) {
    const rawHeader = request.header(headerName)
    if (!rawHeader) {
      continue
    }

    try {
      const url = new URL(rawHeader)
      const hostname = url.hostname.trim().toLowerCase()
      if (hostname.length > 0) {
        return hostname
      }
    }
    catch {
      const normalized = rawHeader.trim().toLowerCase()
      if (normalized.length > 0) {
        return normalized
      }
    }
  }

  return undefined
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
    const token = request.headers.authorization?.split('Bearer ')[1]
    if (!token) {
      throw new Error('No token provided')
    }

    try {
      const partner = await partnerService.getPartnerFromSepJwt(token)
      return partner
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
