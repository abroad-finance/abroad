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
      const parseAmount = (value: string, field: string): number => {
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) {
          throw new Error(`Transfero Ultra returned an invalid ${field} balance for ${balance.asset}`)
        }
        return parsed
      }
      const availableAmount = parseAmount(balance.available, 'available')
      const blockedAmount = parseAmount(balance.blocked, 'blocked')
      const reservedAmount = parseAmount(balance.processing, 'processing')
        + parseAmount(balance.openWithdrawals, 'open withdrawals')
      const outstandingAmount = parseAmount(balance.openDebt, 'open debt')
        + parseAmount(balance.overdueDebt, 'overdue debt')
        + parseAmount(balance.owedDue, 'owed due')

      return {
        account: balance.asset,
        amount: parseAmount(balance.ledgerBalance, 'ledger'),
        availableAmount,
        blockedAmount,
        currency: balance.asset,
        outstandingAmount,
        reservedAmount,
        venue: this.venue,
      }
    })
  }
}
