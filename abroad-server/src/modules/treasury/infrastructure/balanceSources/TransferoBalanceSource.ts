import { inject, injectable } from 'inversify'

import { TransferoUltraClient } from '../../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraBalanceResponseSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

@injectable()
export class TransferoBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'TRANSFERO' as const

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
  ) {}

  public async getBalances(): Promise<TreasuryBalance[]> {
    const response = await this.ultraClient.get('/api/v1/balance')
    const balances = transferoUltraBalanceResponseSchema.parse(response)

    return balances.map((balance) => {
      const amount = Number(balance.available)
      if (!Number.isFinite(amount)) {
        throw new Error(`Transfero Ultra returned an invalid available balance for ${balance.asset}`)
      }

      return {
        account: balance.asset,
        amount,
        currency: balance.asset,
        venue: this.venue,
      }
    })
  }
}
