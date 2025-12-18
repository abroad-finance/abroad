// src/interfaces/IPaymentService.ts
import { TargetCurrency } from '@prisma/client'

export interface IPaymentService {
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

  sendPayment(params: {
    account: string
    id: string
    qrCode?: null | string
    value: number
  }): Promise<
    | {
      success: false
    }
    | {
      success: true
      transactionId: string
    }
  >

  verifyAccount({
    account,
  }: {
    account: string
  }): Promise<boolean>
}
