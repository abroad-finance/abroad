// src/services/PaymentServiceFactory.ts
import { PaymentMethod } from '@prisma/client'
import { inject, injectable, named } from 'inversify'

import { IPaymentService } from '../interfaces/IPaymentService'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'

@injectable()
export class PaymentServiceFactory implements IPaymentServiceFactory {
  constructor(
    @inject(TYPES.IPaymentService)
    @named('movii')
    private moviiPaymentService: IPaymentService,
    @inject(TYPES.IPaymentService)
    @named('nequi')
    private nequiPaymentService: IPaymentService,
    @named('transfero')
    @inject(TYPES.IPaymentService)
    private transferoPaymentService: IPaymentService,
  ) { }

  public getPaymentService(paymentMethod: PaymentMethod): IPaymentService {
    switch (paymentMethod) {
      case PaymentMethod.MOVII:
        return this.moviiPaymentService
      case PaymentMethod.NEQUI:
        return this.nequiPaymentService
      case PaymentMethod.PIX:
        return this.transferoPaymentService
      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`)
    }
  }
}
