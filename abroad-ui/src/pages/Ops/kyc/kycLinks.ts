/**
 * Deep link into the KYC review queue, narrowed to one submission — how a
 * transaction investigation reaches the identity behind it. Revealing that
 * identity stays the queue's own audited step.
 */
export const kycSubmissionPath = (kycId: string): string => (
  `/ops/kyc?kycId=${encodeURIComponent(kycId)}`
)
