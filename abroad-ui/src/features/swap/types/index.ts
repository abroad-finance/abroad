// Extend views to include transaction status screen shown right after user signs the tx
// and a confirmation screen for decoded QR data
export type SwapView = 'bankDetails' | 'confirm-qr' | 'home' | 'kyc-needed' | 'swap' | 'txStatus' | 'wait-sign'
