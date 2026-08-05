import { PaymentMethod, TargetCurrency } from '@prisma/client'

export type FiatDepositCapability = {
  method: PaymentMethod
  targetCurrency: TargetCurrency
}

export type FiatDepositCreateResult
  = | {
    /** EMV copy-paste payload the customer pays. */
    brCode: string
    expiresAt: Date | null
    providerDepositId: string
    success: true
  }
  | {
    code?: FiatDepositFailureCode
    reason: string
    success: false
  }

export type FiatDepositFactsResult
  = | { code?: FiatDepositFailureCode, reason: string, success: false }
    | { facts: FiatDepositFacts, success: true }

export type FiatDepositFailureCode = 'permanent' | 'retriable' | 'validation'

export type FiatDepositRefundResult
  = | { code?: FiatDepositFailureCode, reason: string, success: false }
    | { providerRefundId: string, success: true }

/**
 * Provider-agnostic deposit lifecycle.
 *
 * `PAID` means the money arrived but is not yet spendable; only `COMPLETED`
 * means the credit landed. Crypto is never released before `COMPLETED`.
 */
export type FiatDepositStatus
  = | 'AWAITING_PAYMENT'
    | 'COMPLETED'
    | 'EXPIRED'
    | 'FAILED'
    | 'PAID'
    | 'REFUNDED'

/**
 * Collects fiat from a customer, the inbound mirror of {@link IPaymentService}.
 *
 * A FIAT_TO_CRYPTO transaction asks the provider for a payment instrument the
 * customer settles from their own bank, then learns it was paid by webhook or
 * by polling. Nothing here releases crypto: a deposit is only ever a credit
 * into Abroad's own balance, and the delivery decision belongs to the flow.
 */
export interface IFiatDepositService {
  readonly capability: FiatDepositCapability

  /**
   * Issues a single-use instrument for exactly `amount`. Implementations must
   * derive their idempotency from `transactionId`, so a retried acceptance
   * returns the original instrument rather than asking the customer to pay a
   * second one.
   */
  createDeposit(params: {
    amount: number
    /** Our transaction id, echoed back on the provider's deposit reads and webhooks. */
    reference: string
    transactionId: string
  }): Promise<FiatDepositCreateResult>

  readonly currency: TargetCurrency

  /**
   * Authoritative read of one deposit, used to reconcile an ambiguous webhook
   * or an unacknowledged create. Never infer settlement from a create response.
   */
  getDepositFacts(providerDepositId: string): Promise<FiatDepositFactsResult>

  readonly isEnabled: boolean

  readonly MAX_USER_AMOUNT_PER_TRANSACTION: number

  readonly MIN_USER_AMOUNT_PER_TRANSACTION: number

  readonly provider: string

  /**
   * Returns a settled deposit to whoever paid it. The provider resolves the
   * payer from the original deposit — a refund destination is never accepted
   * from a caller, so a compromised request cannot redirect customer funds.
   */
  refundDeposit(params: {
    providerDepositId: string
    transactionId: string
  }): Promise<FiatDepositRefundResult>
}

type FiatDepositFacts = {
  /** Amount actually credited, which is not necessarily the amount requested. */
  amount: number
  endToEndId: null | string
  /** Full payer tax id, recorded for reconciliation. Not a delivery gate. */
  payerTaxId: null | string
  providerDepositId: string
  status: FiatDepositStatus
}
