// src/interfaces/IPaymentService.ts
import { PaymentMethod, TargetCurrency } from '@prisma/client'

export interface IPaymentService {
  readonly capability?: PaymentCapability
  readonly currency: TargetCurrency
  readonly fixedFee: number
  /**
   * Gets the current liquidity for the payment service.
   *
   * Must reject when the balance cannot be read. A failed read is not a zero
   * balance: resolving 0 lets callers cache "no float" and reject every payout
   * on this method until the provider recovers.
   * @returns A promise that resolves to the liquidity amount.
   */
  getLiquidity: () => Promise<number>

  getPaymentFacts?(providerTransactionId: string): Promise<PaymentFactsResult>

  readonly isAsync: boolean
  readonly isEnabled: boolean
  readonly MAX_TOTAL_AMOUNT_PER_DAY: number
  readonly MAX_USER_AMOUNT_PER_DAY: number
  readonly MAX_USER_AMOUNT_PER_TRANSACTION: number
  readonly MAX_USER_TRANSACTIONS_PER_DAY: number

  readonly MIN_USER_AMOUNT_PER_TRANSACTION: number

  onboardUser({ account }: {
    account: string
  }): Promise<PaymentOnboardResult>

  readonly percentageFee: number

  readonly provider?: string

  sendPayment(params: {
    account: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<PaymentSendResult>

  verifyAccount({
    account,
  }: {
    account: string
  }): Promise<boolean>
}

export type PaymentCapability = {
  method: PaymentMethod
  targetCurrency: TargetCurrency
}

export type PaymentFactsResult
  = | { economics?: PaymentSendEconomics, success: true }
    | { reason: string, success: false }

export type PaymentFailureCode = 'permanent' | 'retriable' | 'validation'

export interface PaymentOnboardResult {
  message?: string
  success: boolean
}

export type PaymentSendResult
  = | {
    code?: PaymentFailureCode
    reason?: string
    success: false
    transactionId?: string
  }
  | {
    economics?: PaymentSendEconomics
    success: true
    transactionId?: string
  }

type PaymentSendEconomics = {
  feeCurrency: TargetCurrency
  feeNative: string
  netAmountNative: string
}
