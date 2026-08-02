import type { OpsAdministrationRole } from './administrationTypes'

export const kycStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PENDING_APPROVAL',
] as const
export interface OpsKycAssignment {
  id: string
  reviewer: null | OpsKycReviewer
  version: number
}

export interface OpsKycDetail {
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
  reviewer: null | OpsKycReviewer
  status: OpsKycStatus
  submittedAt: string
  userId: string
  version: number
}

export type OpsKycDocumentType
  = 'DRIVERS_LICENSE' | 'FOREIGN_ID' | 'NATIONAL_ID' | 'OTHER' | 'PASSPORT'

export interface OpsKycListFilters {
  ageHoursGte?: number
  createdFrom?: string
  createdTo?: string
  documentType?: OpsKycDocumentType
  nationality?: string
  page?: number
  pageSize?: number
  partnerId?: string
  query?: string
  reviewer?: string
  status?: '' | OpsKycStatus
}

export interface OpsKycListResponse {
  items: OpsKycSummary[]
  page: number
  pageSize: number
  total: number
}

export interface OpsKycReviewer {
  displayName: string
  id: string
  role: OpsAdministrationRole
}

export type OpsKycStatus = typeof kycStatuses[number]

export interface OpsKycSummary {
  disabledAt: null | string
  documentNumberMasked: null | string
  documentType: null | OpsKycDocumentType
  emailMasked: null | string
  fullNameMasked: null | string
  hasDocument: boolean
  id: string
  nationality: null | string
  partnerId: string
  partnerName: string
  partnerUserId: string
  reviewedAt: null | string
  reviewer: null | OpsKycReviewer
  status: OpsKycStatus
  submittedAt: string
  version: number
}

export interface OpsKycUserState {
  disabledAt: null | string
  partnerUserId: string
}
