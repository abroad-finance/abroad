/**
 * PIX withdrawal facts read back from the payout provider, for partner-facing
 * receipts and end-to-end-id reconciliation.
 *
 * Both operations return a Result rather than throwing, and the failure reasons
 * are the distinctions the callers actually branch on — not provider status
 * codes. That is deliberate: `not_found` in particular drives a settling-window
 * decision about whether a missing record is permanent or just replication lag,
 * so it has to survive as a first-class outcome rather than arrive as an HTTP
 * 404 the application layer has to decode.
 *
 * The adapter owns response parsing. A payload that does not match the expected
 * shape, or that describes a different withdrawal than the one requested, is
 * `invalid_response` — never a partially-trusted object.
 */
export interface IPartnerPixProvider {
  /**
   * The provider's own PDF receipt for a settled withdrawal.
   *
   * `unavailable` means the provider knows the withdrawal but has no receipt to
   * give yet; `provider_error` is everything else and is safe to retry.
   */
  fetchWithdrawalReceipt(params: {
    language: string
    withdrawalId: string
  }): Promise<PixReceiptResult>

  readWithdrawalDetail(withdrawalId: string): Promise<PixWithdrawalReadResult>
}

export type PixReceiptResult
  = | { contentType: string, data: Buffer, success: true }
    | { reason: PixReceiptFailureReason, success: false }

export type PixWithdrawalReadResult
  = | { detail: PixWithdrawalDetail, success: true }
    | { reason: PixWithdrawalReadFailureReason, success: false }

type PixReceiptFailureReason = 'provider_error' | 'unavailable'

type PixWithdrawalDetail = {
  /** Null until the provider settles the payout and the rail assigns one. */
  endToEndId: null | string
  id: string
  status: string
}

type PixWithdrawalReadFailureReason
  = 'invalid_response'
    | 'not_found'
    | 'provider_unavailable'
