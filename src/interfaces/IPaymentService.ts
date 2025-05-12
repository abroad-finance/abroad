// src/interfaces/IPaymentService.ts
import { TargetCurrency } from '@prisma/client'

export interface IPaymentService {
  readonly banks: Bank[]
  readonly currency: TargetCurrency
  readonly fixedFee: number

  /**
   * Gets the current liquidity for the payment service.
   * @returns A promise that resolves to the liquidity amount.
   */
  getLiquidity: () => Promise<number>
  readonly MAX_TOTAL_AMOUNT_PER_DAY: number
  readonly MAX_USER_AMOUNT_PER_DAY: number
  readonly MAX_USER_AMOUNT_PER_TRANSACTION: number

  readonly MAX_USER_TRANSACTIONS_PER_DAY: number

  onboardUser({ account }: {
    account: string
  }): Promise<{
    message?: string
    success: boolean
  }>

  readonly percentageFee: number

  sendPayment({
    account,
    bankCode,
    id,
    value,
  }: {
    account: string
    bankCode: string
    id: string
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
    bankCode,
  }: {
    account: string
    bankCode: string
  }): Promise<boolean>
}

interface Bank {
  bankCode: number
  bankName: string
}
