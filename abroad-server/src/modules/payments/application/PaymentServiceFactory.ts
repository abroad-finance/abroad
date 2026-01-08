// src/modules/payments/application/PaymentServiceFactory.ts
import { PaymentMethod } from '@prisma/client'
import { inject, injectable, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IPaymentService } from './contracts/IPaymentService'
import { IPaymentServiceFactory } from './contracts/IPaymentServiceFactory'
import { assertSupportedPaymentMethod, SupportedPaymentMethod } from './supportedPaymentMethods'

type PaymentCapability = {
  method: SupportedPaymentMethod
  targetCurrency: IPaymentService['currency']
}

@injectable()
export class PaymentServiceFactory implements IPaymentServiceFactory {
  private readonly serviceByMethod: Record<SupportedPaymentMethod, IPaymentService>
  private readonly capabilityMap: PaymentCapability[]

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
    this.capabilityMap = [
      { method: PaymentMethod.BREB, targetCurrency: brebPaymentService.currency },
      { method: PaymentMethod.PIX, targetCurrency: transferoPaymentService.currency },
    ]
  }

  public getPaymentService(paymentMethod: PaymentMethod): IPaymentService {
    assertSupportedPaymentMethod(paymentMethod)
    return this.serviceByMethod[paymentMethod]
  }

  /**
   * Returns a payment service that supports the requested payment method and target currency.
   * Falls back to the method-only lookup for backward compatibility.
   */
  public getPaymentServiceForCapability(params: {
    paymentMethod: PaymentMethod
    targetCurrency: IPaymentService['currency']
  }): IPaymentService {
    assertSupportedPaymentMethod(params.paymentMethod)
    const capability = this.capabilityMap.find(
      candidate => candidate.method === params.paymentMethod
        && candidate.targetCurrency === params.targetCurrency,
    )
    if (capability) {
      return this.serviceByMethod[capability.method]
    }
    return this.getPaymentService(params.paymentMethod)
  }
}
