// src/app/http/authentication.ts

import { Partner } from '@prisma/client'
import { Request } from 'express'

import { IPartnerService } from '../../modules/partners/application/contracts/IPartnerService'
import { iocContainer } from '../container'
import { TYPES } from '../container/types'

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

    try {
      const partner = await partnerService.getPartnerFromSepJwt(token)
      return partner
    }
    catch {
      throw new Error('Invalid token or partner not found')
    }
  }

  throw new Error('Invalid security scheme')
}
