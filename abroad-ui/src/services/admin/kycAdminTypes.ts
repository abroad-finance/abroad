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
  /** Deep link to a single submission, e.g. the KYC behind a transaction. */
  kycId?: string
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

/** The customer identity behind a transaction, masked as the queue is. */
export interface OpsKycTransactionLink {
  /**
   * The submission on file when the transaction was created — what the
   * transaction was accepted against. Null when the user only submitted KYC
   * afterwards, or never did.
   */
  effectiveSubmissionId: null | string
  partnerUser: {
    disabledAt: null | string
    id: string
    partnerId: string
    partnerName: string
    userId: string
  }
  submissions: OpsKycSummary[]
  transactionId: string
}

export interface OpsKycUserState {
  disabledAt: null | string
  partnerUserId: string
}
