// src/modules/payments/application/PaymentServiceFactory.ts
import { PaymentMethod } from '@prisma/client'
import { inject, injectable, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IPaymentService } from './contracts/IPaymentService'
import { IPaymentServiceFactory } from './contracts/IPaymentServiceFactory'
import { assertSupportedPaymentMethod, SupportedPaymentMethod } from './supportedPaymentMethods'

@injectable()
export class PaymentServiceFactory implements IPaymentServiceFactory {
  private readonly serviceByMethod: Record<SupportedPaymentMethod, IPaymentService>

  constructor(
    @inject(TYPES.IPaymentService)
    @named('breb')
    brebPaymentService: IPaymentService,
    @inject(TYPES.IPaymentService)
    @named('transfero')
    transferoPaymentService: IPaymentService,
  ) {
    this.serviceByMethod = {
      [PaymentMethod.BREB]: brebPaymentService,
      [PaymentMethod.PIX]: transferoPaymentService,
    }
  }

  public getPaymentService(paymentMethod: PaymentMethod): IPaymentService {
    assertSupportedPaymentMethod(paymentMethod)
    return this.serviceByMethod[paymentMethod]
  }
}
