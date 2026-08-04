import { Partner } from '@prisma/client'

import type { ClientDomain } from '../../domain/clientDomain'
import type { PartnerApiKeyScopeName } from '../partnerApiKeyScopes'

export type AuthenticatedPartner = Partner & {
  authenticatedSubject?: string
  authenticationSource: PartnerAuthenticationSource
}

export type AuthenticatedWalletPrincipal = AuthenticatedPartner & {
  authenticatedSubject: string
  authenticationSource: 'WALLET'
}

export type BearerAuthentication = {
  authenticatedSubject: string
  partner: Partner
  source: Extract<PartnerAuthenticationSource, 'SEP_24' | 'WALLET'>
}

export interface IPartnerService {
  authenticateApiKey(apiKey?: string): Promise<PartnerApiKeyAuthentication>
  authenticateBearerToken(token: string): Promise<BearerAuthentication>
  getPartnerFromApiKey(apiKey?: string): Promise<Partner>
  getPartnerFromClientDomain(clientDomain: ClientDomain): Promise<Partner>
}

export type PartnerApiKeyAuthentication
  = | {
    keyId: string
    kind: 'MANAGED'
    partner: Partner
    scopes: readonly PartnerApiKeyScopeName[]
  }
  | {
    kind: 'LEGACY'
    partner: Partner
  }

export type PartnerAuthenticationSource
  = | 'API_KEY'
    | 'CLIENT_DOMAIN'
    | 'PARTNER_PORTAL'
    | 'SEP_24'
    | 'WALLET'
