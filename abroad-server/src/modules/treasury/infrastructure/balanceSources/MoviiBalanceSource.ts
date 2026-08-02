import { PaymentMethod } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { IPaymentServiceFactory } from '../../../payments/application/contracts/IPaymentServiceFactory'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

/**
 * COP float held at Movii, read through the existing BreB payment service's
 * getLiquidity (the same number the payout admission checks use).
 *
 * Known limitation: IPaymentService.getLiquidity swallows provider failures
 * and returns 0, so this venue can render 0 instead of an error chip when
 * Movii is down. Fixing that means changing the shared payment-service error
 * contract — out of scope here; treat a sudden 0 with suspicion.
 */
@injectable()
export class MoviiBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'MOVII' as const

  constructor(
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
  ) {}

  public async getBalances(): Promise<TreasuryBalance[]> {
    const service = this.paymentServiceFactory.getPaymentService(PaymentMethod.BREB)
    const liquidity = await service.getLiquidity()
    const amount = Number(liquidity) || 0
    return [{
      account: '',
      amount,
      availableAmount: amount,
      blockedAmount: null,
      currency: 'COP',
      outstandingAmount: null,
      reservedAmount: null,
      venue: this.venue,
    }]
  }
}
