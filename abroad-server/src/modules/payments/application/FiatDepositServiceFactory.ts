import { PaymentMethod, TargetCurrency } from '@prisma/client'
import { inject, injectable, named } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IFiatDepositService } from './contracts/IFiatDepositService'
import { FiatDepositServiceUnavailableError, IFiatDepositServiceFactory } from './contracts/IFiatDepositServiceFactory'

@injectable()
export class FiatDepositServiceFactory implements IFiatDepositServiceFactory {
  private readonly services: readonly IFiatDepositService[]

  constructor(
    @inject(TYPES.IFiatDepositService)
    @named('transfero')
    transferoPixDepositService: IFiatDepositService,
  ) {
    this.services = [transferoPixDepositService]
  }

  public getForCapability(params: {
    paymentMethod: PaymentMethod
    targetCurrency: TargetCurrency
  }): IFiatDepositService {
    const service = this.services.find(
      candidate => candidate.capability.method === params.paymentMethod
        && candidate.capability.targetCurrency === params.targetCurrency
        && candidate.isEnabled,
    )
    if (!service) {
      throw new FiatDepositServiceUnavailableError(params.paymentMethod, params.targetCurrency)
    }
    return service
  }
}
