import { PaymentMethod, TargetCurrency } from '@prisma/client'

import { IFiatDepositService } from './IFiatDepositService'

export interface IFiatDepositServiceFactory {
  /**
   * Resolves the collection rail for a FIAT_TO_CRYPTO corridor. Throws rather
   * than falling back to another method: quoting a corridor we cannot actually
   * collect on would hand the customer an instrument nobody can settle.
   */
  getForCapability(params: {
    paymentMethod: PaymentMethod
    targetCurrency: TargetCurrency
  }): IFiatDepositService
}

export class FiatDepositServiceUnavailableError extends Error {
  constructor(paymentMethod: PaymentMethod, targetCurrency: TargetCurrency) {
    super(`No fiat deposit service collects ${targetCurrency} over ${paymentMethod}`)
    this.name = 'FiatDepositServiceUnavailableError'
  }
}
