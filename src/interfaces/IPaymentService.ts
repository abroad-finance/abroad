import { TargetCurrency } from '@prisma/client'

export interface IPaymentService {
  readonly banks: Bank[]
  readonly currency: TargetCurrency
  readonly fixedFee: number
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
