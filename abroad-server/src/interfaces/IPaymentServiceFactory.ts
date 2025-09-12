// src/interfaces/IPaymentServiceFactory.ts
import { PaymentMethod } from '@prisma/client'

import { IPaymentService } from './IPaymentService'

export interface IPaymentServiceFactory {
  getPaymentService(paymentMethod: PaymentMethod): IPaymentService
}
