import { Partner } from '@prisma/client'

export interface IPartnerService {
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromClientDomain(clientDomain: string): Promise<Partner>
  getPartnerFromSepJwt(token: string): Promise<Partner>
}
