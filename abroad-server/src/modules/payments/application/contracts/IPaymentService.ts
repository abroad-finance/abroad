// src/interfaces/IPaymentService.ts
import { PaymentMethod, TargetCurrency } from '@prisma/client'

export interface IPaymentService {
  readonly capability?: {
    method: PaymentMethod
    targetCurrency: TargetCurrency
  }
  readonly currency: TargetCurrency
  readonly fixedFee: number
  /**
   * Gets the current liquidity for the payment service.
   * @returns A promise that resolves to the liquidity amount.
   */
  getLiquidity: () => Promise<number>

  readonly isAsync: boolean
  readonly isEnabled: boolean
  readonly MAX_TOTAL_AMOUNT_PER_DAY: number
  readonly MAX_USER_AMOUNT_PER_DAY: number
  readonly MAX_USER_AMOUNT_PER_TRANSACTION: number
  readonly MAX_USER_TRANSACTIONS_PER_DAY: number

  readonly MIN_USER_AMOUNT_PER_TRANSACTION: number

  onboardUser({ account }: {
    account: string
  }): Promise<{
    message?: string
    success: boolean
  }>

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

export type PaymentFailureCode = 'validation' | 'retriable' | 'permanent'

export type PaymentSendResult =
  | {
    success: true
    transactionId?: string
  }
  | {
    code?: PaymentFailureCode
    reason?: string
    success: false
    transactionId?: string
  }

export type PaymentCapability = {
  method: PaymentMethod
  targetCurrency: TargetCurrency
}

export interface PaymentVerificationResult {
  code: PaymentFailureCode
  reason?: string
  success: boolean
}

export interface PaymentLiquidityResult {
  liquidity: number
  message?: string
  success: boolean
}

export interface PaymentOnboardResult {
  message?: string
  success: boolean
}
