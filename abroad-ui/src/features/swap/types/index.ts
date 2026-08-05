// Self-service KYC form values collected by the KycForm component and submitted
// through the controller (feature components do not call services directly).
export type KycDocumentType
  = | 'DRIVERS_LICENSE'
    | 'FOREIGN_ID'
    | 'NATIONAL_ID'
    | 'OTHER'
    | 'PASSPORT'

export interface KycFormValues {
  address: string
  city: string
  dateOfBirth: string
  document: File
  documentNumber: string
  documentType: KycDocumentType
  email: string
  fullName: string
  nationality: string
  phone: string
}

export type KycSubmissionStatus = 'APPROVED' | 'PENDING' | 'PENDING_APPROVAL' | 'REJECTED'

export interface KycSubmitOutcome {
  error?: string
  errorCode?: 'network' | 'service-unavailable' | 'unknown' | 'validation'
  ok: boolean
  status?: KycSubmissionStatus
}

export type OnboardingRates = {
  brl: {
    USDC: null | number
    USDT: null | number
  }
  cop: {
    USDC: null | number
    USDT: null | number
  }
  updatedAt: null | string
}

export type QrEntryMode = 'camera' | 'paste' | 'upload'

// Extend views to include transaction status screen shown right after user signs the tx
// and a confirmation screen for decoded QR data
export type SwapView = 'buy-crypto' | 'buy-crypto-pix' | 'confirm-qr' | 'home' | 'kyc-needed' | 'swap' | 'txStatus' | 'wait-sign'
