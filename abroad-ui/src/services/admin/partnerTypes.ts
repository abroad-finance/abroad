export type OpsCreatePartnerInput = {
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone?: string
}

export type OpsPartner = {
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

export type OpsPartnerListResponse = {
  items: OpsPartner[]
  page: number
  pageSize: number
  total: number
}

export type OpsCreatePartnerResponse = {
  apiKey: string
  partner: OpsPartner
}

export type OpsRotatePartnerApiKeyResponse = {
  apiKey: string
  partner: OpsPartner
}
