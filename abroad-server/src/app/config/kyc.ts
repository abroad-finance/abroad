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
  if (isKycTemporarilyDisabled()) {
    return true
  }
  return amountInUsd <= KYC_EXEMPTION_USD_THRESHOLD
}

/**
 * TEMPORARY (2026-06-10): KYC is disabled for everyone.
 *
 * While this returns true, no user is asked to complete verification —
 * regardless of amount, country, or existing tier — no Persona inquiries
 * are created, and transactions proceed straight to acceptance.
 *
 * Restore enforcement by setting ENFORCE_KYC=true in the environment
 * (no deploy needed), or remove this switch to make enforcement
 * permanent again. The test suite sets ENFORCE_KYC=true in jest setup
 * so tier/exemption logic stays covered while the switch is active.
 */
export function isKycTemporarilyDisabled(): boolean {
  return process.env.ENFORCE_KYC !== 'true'
}
