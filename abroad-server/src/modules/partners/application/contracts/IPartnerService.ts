import { Partner } from '@prisma/client'

import type { ClientDomain } from '../../domain/clientDomain'

export type AuthenticatedPartner = Partner & {
  authenticationSource: PartnerAuthenticationSource
}

export type BearerAuthentication = {
  partner: Partner
  source: Extract<PartnerAuthenticationSource, 'SEP_24' | 'WALLET'>
}

export interface IPartnerService {
  authenticateBearerToken(token: string): Promise<BearerAuthentication>
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromClientDomain(clientDomain: ClientDomain): Promise<Partner>
}

export type PartnerAuthenticationSource
  = | 'API_KEY'
    | 'CLIENT_DOMAIN'
    | 'PARTNER_PORTAL'
    | 'SEP_24'
    | 'WALLET'
