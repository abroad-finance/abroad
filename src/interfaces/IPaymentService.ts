import { TargetCurrency } from '@prisma/client'

export interface IPaymentService {
  readonly currency: TargetCurrency
  readonly fixedFee: number
  readonly percentageFee: number

  sendPayment({
    account,
    id,
    value,
  }: {
    account: string
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
