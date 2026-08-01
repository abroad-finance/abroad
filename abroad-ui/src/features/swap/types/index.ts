// Self-service KYC form values collected by the KycForm component and submitted
// through the controller (feature components do not call services directly).
export interface KycFormValues {
  address: string
  city: string
  dateOfBirth: string
  document: File
  documentNumber: string
  documentType: string
  email: string
  fullName: string
  nationality: string
  phone: string
}

export interface KycSubmitOutcome {
  error?: string
  ok: boolean
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
}

export type QrEntryMode = 'camera' | 'paste' | 'upload'

// Extend views to include transaction status screen shown right after user signs the tx
// and a confirmation screen for decoded QR data
export type SwapView = 'bankDetails' | 'confirm-qr' | 'home' | 'kyc-needed' | 'swap' | 'txStatus' | 'wait-sign'
