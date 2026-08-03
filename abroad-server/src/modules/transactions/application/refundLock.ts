export const REFUND_LOCK_ACQUIRE_TIMEOUT_MS = 20_000

export const refundLockKey = (transactionId: string): string => (
  `transaction-refund:${transactionId}`
)
