/**
 * Presentation-facing shape of a fiat-to-crypto purchase.
 *
 * The field names keep the meaning they have on a payout: `sourceAmount` is
 * always the crypto leg and `targetAmount` always the fiat leg. On an onramp
 * the customer pays the fiat leg and receives the crypto leg.
 */
export type OnrampQuoteView = {
  sourceAmount: number
  sourceCurrency: string
  targetAmount: number
  targetCurrency: string
}

/** What the customer needs in order to fund the purchase. */
export type PaymentInstructionsView = {
  brCode: string
  /** Epoch milliseconds, or null when the code carries no expiry. */
  expiresAt: null | number
}

/**
 * Whether the customer can still pay the code. A code with no stated expiry is
 * treated as payable — the backend, not the browser clock, owns settlement.
 */
export const arePaymentInstructionsExpired = (
  instructions: PaymentInstructionsView,
  now: number = Date.now(),
): boolean => instructions.expiresAt !== null && instructions.expiresAt <= now

export const formatExpiryCountdown = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export const millisecondsUntilExpiry = (
  instructions: PaymentInstructionsView,
  now: number = Date.now(),
): null | number => {
  if (instructions.expiresAt === null) return null
  return Math.max(0, instructions.expiresAt - now)
}
