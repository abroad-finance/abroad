import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

// Always reported even at zero so the dashboard shows the coins we operate in
// (a silent zero is information; a missing row looks like a query gap).
const CORE_COINS = new Set(['BRL', 'COP', 'USDC', 'USDT'])

/**
 * Spot balances of the single Binance account (free + locked per coin). Uses
 * the same key/secret/proxy trio as the trading path but only calls the
 * read-only account endpoint.
 */
@injectable()
export class BinanceBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'BINANCE' as const
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'BinanceBalanceSource' })
  }

  public async getBalances(): Promise<TreasuryBalance[]> {
    const {
      BINANCE_API_KEY: apiKey,
      BINANCE_API_SECRET: apiSecret,
      BINANCE_API_URL: apiUrl,
    } = await this.secretManager.getSecrets([
      'BINANCE_API_KEY',
      'BINANCE_API_SECRET',
      'BINANCE_API_URL',
    ])

    const client = new MainClient({
      api_key: apiKey,
      api_secret: apiSecret,
      baseUrl: apiUrl,
    })

    const account = await client.getAccountInformation()
    const balances: TreasuryBalance[] = []

    for (const entry of account.balances ?? []) {
      const total = (Number(entry.free) || 0) + (Number(entry.locked) || 0)
      if (total <= 0 && !CORE_COINS.has(entry.asset)) continue
      balances.push({
        account: '',
        amount: total,
        currency: entry.asset,
        venue: this.venue,
      })
    }

    // The account endpoint omits zero balances entirely on some deployments —
    // backfill the core coins so the board always renders them.
    for (const coin of CORE_COINS) {
      if (!balances.some(balance => balance.currency === coin)) {
        balances.push({ account: '', amount: 0, currency: coin, venue: this.venue })
      }
    }

    this.logger.info('Fetched Binance spot balances', { coins: balances.length })
    return balances
  }
}
