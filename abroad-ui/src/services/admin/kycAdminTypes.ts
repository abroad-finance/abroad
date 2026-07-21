export const kycStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PENDING_APPROVAL',
] as const
export type OpsKycDocumentType
  = 'DRIVERS_LICENSE' | 'FOREIGN_ID' | 'NATIONAL_ID' | 'OTHER' | 'PASSPORT'

export interface OpsKycListResponse {
  items: OpsKycSummary[]
  page: number
  pageSize: number
  total: number
}

export type OpsKycStatus = typeof kycStatuses[number]

export interface OpsKycSummary {
  address: null | string
  city: null | string
  dateOfBirth: null | string
  disabledAt: null | string
  documentNumber: null | string
  documentType: null | OpsKycDocumentType
  email: null | string
  fullName: null | string
  hasDocument: boolean
  id: string
  nationality: null | string
  partnerId: string
  partnerName: string
  partnerUserId: string
  phone: null | string
  reviewedAt: null | string
  status: OpsKycStatus
  submittedAt: string
  userId: string
}

export interface OpsKycUserState {
  disabledAt: null | string
  partnerUserId: string
}
