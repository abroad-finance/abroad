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
  email?: string
  firstName?: string
  hasApiKey: boolean
  id: string
  isKybApproved: boolean
  lastName?: string
  name: string
  needsKyc: boolean
  phone?: string
}

export type OpsPartnerCompletedVolume = {
  completedTransactions: number
  payout: OpsPartnerPayoutVolume[]
  source: OpsPartnerSourceVolume[]
  stablecoinAmount: number
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
