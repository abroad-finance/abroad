import type { PaymentFailureCode } from './IPaymentService'

export interface IPixQrDecoder {
  decode(qrCode: string): Promise<null | PixDecoded>
  validateForPayment(params: {
    idempotencyKey: string
    qrCode: string
  }): Promise<PixQrValidationResult>
}

export interface PixDecoded {
  account?: string
  amount?: string
  currency?: string
  name?: string
  taxId?: null | string
}

export type PixQrValidationResult
  = | { code: PaymentFailureCode, reason: string, success: false }
    | { decoded: PixDecoded, success: true }
