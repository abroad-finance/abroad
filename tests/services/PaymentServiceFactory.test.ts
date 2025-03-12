// tests/PaymentServiceFactory.test.ts

import { PaymentMethod } from '@prisma/client'

import { IPaymentService } from '../../src/interfaces/IPaymentService'
import { PaymentServiceFactory } from '../../src/services/PaymentServiceFactory'

describe('PaymentServiceFactory', () => {
  let moviiPaymentService: IPaymentService
  let nequiPaymentService: IPaymentService
  let paymentServiceFactory: PaymentServiceFactory

  beforeEach(() => {
    // Create simple mocks for the IPaymentService interface.
    // You can add more mock implementations if needed.
    moviiPaymentService = { processPayment: jest.fn() } as unknown as IPaymentService
    nequiPaymentService = { processPayment: jest.fn() } as unknown as IPaymentService

    // Instantiate the factory with the mocked payment services.
    paymentServiceFactory = new PaymentServiceFactory(moviiPaymentService, nequiPaymentService)
  })

  it('should return moviiPaymentService for MOVII payment method', () => {
    const result = paymentServiceFactory.getPaymentService(PaymentMethod.MOVII)
    expect(result).toBe(moviiPaymentService)
  })

  it('should return nequiPaymentService for NEQUI payment method', () => {
    const result = paymentServiceFactory.getPaymentService(PaymentMethod.NEQUI)
    expect(result).toBe(nequiPaymentService)
  })

  it('should throw an error for unsupported payment method', () => {
    // Pass an unsupported payment method value.
    const unsupportedMethod = 'unsupported' as PaymentMethod
    expect(() => paymentServiceFactory.getPaymentService(unsupportedMethod)).toThrowError(
      `Unsupported payment method: ${unsupportedMethod.toLowerCase()}`,
    )
  })
})
