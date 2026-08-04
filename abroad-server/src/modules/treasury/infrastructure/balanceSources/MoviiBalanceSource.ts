import { PaymentMethod } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { IPaymentServiceFactory } from '../../../payments/application/contracts/IPaymentServiceFactory'
import { LiquidityCacheService } from '../../../payments/application/LiquidityCacheService'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

/**
 * COP float held at Movii, read through the same liquidity cache the payout
 * admission checks use, so the dashboard and the guard can never disagree.
 *
 * Going through the cache also keeps this venue off Movii's rate limit: the
 * cached value is shared across replicas, so the 5-minute incident scan running
 * on every pod collapses into at most one provider call per TTL.
 */
@injectable()
export class MoviiBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'MOVII' as const

  constructor(
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(LiquidityCacheService) private readonly liquidityCacheService: LiquidityCacheService,
  ) {}

  public async getBalances(): Promise<TreasuryBalance[]> {
    const service = this.paymentServiceFactory.getPaymentService(PaymentMethod.BREB)
    const result = await this.liquidityCacheService.getLiquidity({
      fetchLiquidity: () => service.getLiquidity(),
      method: PaymentMethod.BREB,
    })
    // Surfacing an error chip beats charting a 0 the provider never reported.
    if (!result.success) {
      throw new Error(result.message ?? 'Movii liquidity is unavailable')
    }

    const amount = result.liquidity
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
