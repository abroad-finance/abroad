import { PaymentMethod } from '@prisma/client'

export const SUPPORTED_PAYMENT_METHODS = [
  PaymentMethod.BREB,
  PaymentMethod.PIX,
] as const

export const DEFAULT_PAYMENT_METHOD: SupportedPaymentMethod = SUPPORTED_PAYMENT_METHODS[0]

export type SupportedPaymentMethod = typeof SUPPORTED_PAYMENT_METHODS[number]

export function assertSupportedPaymentMethod(method: PaymentMethod): asserts method is SupportedPaymentMethod {
  if (!SUPPORTED_PAYMENT_METHODS.includes(method as SupportedPaymentMethod)) {
    throw new Error(`Unsupported payment method: ${method}`)
  }
}
