// src/authentication.ts
import { Request } from 'express'

import { IPartnerService } from './interfaces'
import { iocContainer } from './ioc'
import { TYPES } from './types'

export async function expressAuthentication(
  request: Request,
  securityName: string,
) {
  const partnerService = iocContainer.get<IPartnerService>(
    TYPES.IPartnerService,
  )
  if (securityName === 'ApiKeyAuth') {
    return await partnerService.getPartnerFromRequest(request)
  }
  throw new Error('Invalid security scheme')
}
