import { CryptoCurrency } from '@prisma/client'

export type CryptoPurchaseResult
  = | { code: PurchaseFailureCode, reason: string, success: false }
    | { quantity: number, success: true, tradeId: string }

export type CryptoWithdrawalResult
  = | { code: PurchaseFailureCode, reason: string, success: false }
    | { success: true, withdrawalId: string }

/**
 * Buys stablecoin with settled BRL and withdraws it to Abroad's own custody.
 *
 * Both operations are treasury replenishment, never a customer money path, and
 * both are Result-returning rather than throwing: the caller decides whether a
 * failure is worth retrying from the `code`, and an ambiguous provider response
 * must be reconcilable rather than fatal.
 *
 * `operationId` is the caller's stable business identifier and is what the
 * adapter derives its provider idempotency key from, so replaying the same
 * operation must never buy or withdraw twice.
 */
export interface ICryptoPurchaseService {
  buyWithBrl(params: {
    asset: CryptoCurrency
    brlAmount: number
    operationId: string
  }): Promise<CryptoPurchaseResult>

  withdrawToTreasury(params: {
    address: string
    amount: number
    asset: CryptoCurrency
    network: string
    operationId: string
  }): Promise<CryptoWithdrawalResult>
}

export type PurchaseFailureCode = 'permanent' | 'retriable' | 'validation'
