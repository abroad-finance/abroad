// src/config/kyc.ts

/**
 * USD-denominated volume a user can move before KYC is required.
 * Amounts passed to KYC checks use the source asset (USDC) as the unit,
 * so this threshold maps 1:1 to USD.
 */
export const KYC_EXEMPTION_USD_THRESHOLD = 25

/**
 * Determine whether a user's cumulative volume is small enough to bypass KYC.
 */
export function isKycExemptByAmount(amountInUsd: number): boolean {
  if (amountInUsd < 0) {
    throw new Error('Amount cannot be negative')
  }
  return amountInUsd <= KYC_EXEMPTION_USD_THRESHOLD
}
