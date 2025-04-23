// src/authentication.ts

import { Partner } from '@prisma/client'
import { Request } from 'express'

import { IPartnerService } from './interfaces'
import { iocContainer } from './ioc'
import { TYPES } from './types'

export async function expressAuthentication(
  request: Request,
  securityName: string,
): Promise<Partner> {
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
    return partnerService.getPartnerFromBearerToken(token)
  }

  throw new Error('Invalid security scheme')
}
