// src/app/http/authentication.ts

import { Partner } from '@prisma/client'
import { Request } from 'express'

import { IPartnerService } from '../../modules/partners/application/contracts/IPartnerService'
import { iocContainer } from '../container'
import { TYPES } from '../container/types'

type AuthContext = Partner | { kind: 'ops' }

export async function expressAuthentication(
  request: Request,
  securityName: string,
): Promise<AuthContext> {
  const partnerService = iocContainer.get<IPartnerService>(
    TYPES.IPartnerService,
  )

  if (securityName === 'ApiKeyAuth') {
    const apiKey = request.header('X-API-Key')
    if (!apiKey) {
      throw new Error('API key not provided')
    }
    return partnerService.getPartnerFromApiKey(apiKey)
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
    const expected = process.env.OPS_API_KEY
    if (!expected) {
      throw new Error('Ops API key not configured')
    }
    if (!headerKey) {
      throw new Error('Ops API key not provided')
    }
    if (headerKey !== expected) {
      throw new Error('Invalid ops API key')
    }
    return { kind: 'ops' }
  }

  throw new Error('Invalid security scheme')
}
