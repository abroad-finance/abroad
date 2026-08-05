export type OpsCreatePartnerInput = {
  clientDomain?: string
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone?: string
}

export type OpsCreatePartnerResponse = {
  apiKey: string
  partner: OpsPartner
}

export type OpsPartner = {
  clientDomain?: string
  country?: string
  createdAt: string
  disabledAt?: string
  disabledBy?: string
  disabledReason?: string
  email?: string
  firstName?: string
  hasApiKey: boolean
  id: string
  isKybApproved: boolean
  lastName?: string
  legacyKeyOverlapExpiresAt?: string
  name: string
  needsKyc: boolean
  phone?: string
  webhookUrl?: string
}

export type OpsPartnerCompletedVolume = {
  completedTransactions: number
  payout: OpsPartnerPayoutVolume[]
  source: OpsPartnerSourceVolume[]
  stablecoinAmount: number
}

export type OpsPartnerCredentialEvent = {
  action: string
  actorLabel: string
  createdAt: string
  id: string
  reason?: string
  reference?: string
  source: 'OPS' | 'PARTNER_PORTAL'
}

export type OpsPartnerCredentialHistory = {
  events: OpsPartnerCredentialEvent[]
  legacyCredential: {
    active: boolean
    overlapExpiresAt?: string
  }
  managedCredentials: OpsPartnerManagedCredential[]
  partner: OpsPartner
}

export type OpsPartnerListItem = OpsPartner & {
  completedVolume: OpsPartnerCompletedVolume
}

export type OpsPartnerListResponse = {
  items: OpsPartnerListItem[]
  maximumStablecoinAmount: number
  page: number
  pageSize: number
  total: number
}

export type OpsPartnerManagedCredential = {
  createdAt: string
  displayPrefix: string
  expiresAt?: string
  id: string
  lastUsedAt?: string
  name: string
  revokedAt?: string
  rotatedFromId?: string
  rotatedToId?: string
  scopes: string[]
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
}

export type OpsPartnerPayoutVolume = {
  amount: number
  currency: 'BRL' | 'COP'
}

export type OpsPartnerSourceVolume = {
  amount: number
  currency: 'USDC' | 'USDT'
}

export type OpsRotatePartnerApiKeyResponse = {
  apiKey: string
  partner: OpsPartner
}

export type OpsUpdatePartnerClientDomainInput = {
  clientDomain: null | string
}

export type OpsUpdatePartnerClientDomainResponse = OpsPartner

export type OpsUpdatePartnerKybInput = {
  isKybApproved: boolean
}

export type OpsUpdatePartnerKybResponse = OpsPartner

export type OpsUpdatePartnerKycInput = {
  needsKyc: boolean
}

export type OpsUpdatePartnerKycResponse = OpsPartner

/** Omitted keys are left untouched; `null` clears the field. */
export type OpsUpdatePartnerProfileInput = {
  country?: null | string
  email?: null | string
  firstName?: null | string
  lastName?: null | string
  name?: string
  phone?: null | string
}

export type OpsUpdatePartnerProfileResponse = OpsPartner

export type OpsUpdatePartnerStatusInput = {
  disabled: boolean
  reason?: null | string
}

export type OpsUpdatePartnerStatusResponse = OpsPartner

export type OpsUpdatePartnerWebhookInput = {
  webhookUrl: null | string
}

export type OpsUpdatePartnerWebhookResponse = OpsPartner
