import { Partner } from '@prisma/client'

import type { ClientDomain } from '../../domain/clientDomain'

export interface IPartnerService {
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromClientDomain(clientDomain: ClientDomain): Promise<Partner>
  getPartnerFromSepJwt(token: string): Promise<Partner>
}
