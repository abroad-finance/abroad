// src/modules/payments/application/PaymentServiceFactory.ts
import { PaymentMethod } from '@prisma/client'
import { inject, injectable, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IPaymentService } from './contracts/IPaymentService'
import { IPaymentServiceFactory } from './contracts/IPaymentServiceFactory'

@injectable()
export class PaymentServiceFactory implements IPaymentServiceFactory {
  private readonly serviceByMethod: Record<PaymentMethod, IPaymentService>

  constructor(
    @inject(TYPES.IPaymentService)
    @named('movii')
    moviiPaymentService: IPaymentService,
    @inject(TYPES.IPaymentService)
    @named('nequi')
    nequiPaymentService: IPaymentService,
    @inject(TYPES.IPaymentService)
    @named('breb')
    brebPaymentService: IPaymentService,
    @inject(TYPES.IPaymentService)
    @named('transfero')
    transferoPaymentService: IPaymentService,
  ) {
    this.serviceByMethod = {
      [PaymentMethod.BREB]: brebPaymentService,
      [PaymentMethod.MOVII]: moviiPaymentService,
      [PaymentMethod.NEQUI]: nequiPaymentService,
      [PaymentMethod.PIX]: transferoPaymentService,
    }
  }

  public getPaymentService(paymentMethod: PaymentMethod): IPaymentService {
    const service = this.serviceByMethod[paymentMethod]
    if (!service) {
      throw new Error(`Unsupported payment method: ${paymentMethod}`)
    }

    return service
  }
}
