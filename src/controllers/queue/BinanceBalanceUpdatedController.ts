import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

/**
 * Listens for balance‑update events from Binance and automatically converts any available
 * USDC to USDT and then to COP (Colombian peso) using market orders on the Binance Spot
 * market (symbols **USDCUSDT** and **USDTCOP** respectively).
 *
 * ⚠️ This logic assumes that:
 *   • Both trading pairs are enabled on the connected account.
 *   • The account has sufficient balance to satisfy the minimum notional & step‑size rules
 *     for each pair.
 *   • Market orders are acceptable for the conversion (they take taker fees).
 *
 * Consider enriching the logic with dynamic lot‑size/step‑size handling via `exchangeInfo`
 * and adding retry/back‑off in production scenarios.
 */
@injectable()
export class BinanceBalanceUpdatedController {
  constructor(
    @inject(TYPES.ILogger) private logger: ILogger,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private dbClientProvider: IDatabaseClientProvider,
  ) { }

  public registerConsumers(): void {
    this.logger.info(
      '[BinanceBalanceUpdated queue]: Registering consumer for queue:',
      QueueName.BINANCE_BALANCE_UPDATED,
    )
    this.queueHandler.subscribeToQueue(
      QueueName.BINANCE_BALANCE_UPDATED,
      this.onBalanceUpdated.bind(this),
    )
  }

  /**
   * Handler for the balance‑updated event coming from the queue.
   */
  private async onBalanceUpdated(): Promise<void> {
    try {
      // --- Initialise REST client ---------------------------------------------------------
      const apiKey = await this.secretManager.getSecret('BINANCE_API_KEY')
      const apiSecret = await this.secretManager.getSecret('BINANCE_API_SECRET')
      const apiUrl = await this.secretManager.getSecret('BINANCE_API_URL')

      const client = new MainClient({
        api_key: apiKey,
        api_secret: apiSecret,
        baseUrl: apiUrl,
      })

      // --- Fetch current balances --------------------------------------------------------
      const balances = await client.getBalances()

      const clientDb = await this.dbClientProvider.getClient()
      const pendingConversions = await clientDb.pendingConversions.findMany({ where: { amount: { gt: 0 } } })

      for (const pendingConversion of pendingConversions) {
        const balanceRaw = balances.find(b => b.coin === pendingConversion.source)?.free ?? '0'
        const balance = typeof balanceRaw === 'string' ? parseFloat(balanceRaw) : balanceRaw

        const balanceToConvert = Math.min(balance, pendingConversion.amount)
        if (balanceToConvert <= 0) {
          this.logger.info(
            `[BinanceBalanceUpdated queue]: No ${pendingConversion.source} to convert – exiting`,
          )
          return
        }
        // Ensure we respect Binance step size: keep 2 decimals for stable‑coin pairs
        const qty = Math.floor(balanceToConvert)
        if (qty <= 0) {
          this.logger.warn(
            `[BinanceBalanceUpdated queue]: ${pendingConversion.source} balance below minimum tradable size`,
          )
          return
        }
        try {
          // --- Place market order ----------------------------------------------------------
          await this.placeMarketOrder(client, pendingConversion.symbol, pendingConversion.side, qty)
          this.logger.info(
            `[BinanceBalanceUpdated queue]: Converted ${qty} ${pendingConversion.source} to ${pendingConversion.target}`,
          )
          // --- Update pending conversion in DB ------------------------------------------
          await clientDb.pendingConversions.update({
            data: {
              amount: { decrement: qty },
            },
            where: { source_target: { source: pendingConversion.source, target: pendingConversion.target } },
          })
        }
        catch {
          this.logger.error(
            `[BinanceBalanceUpdated queue]: Error placing market order for ${pendingConversion.source} to ${pendingConversion.target}`,
          )
        }
      }
    }
    catch (error) {
      this.logger.error('[BinanceBalanceUpdated queue]: Error processing balance update:', error)
    }
  }

  /**
   * Helper: places a market order.
   */
  private async placeMarketOrder(
    client: MainClient,
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
  ) {
    this.logger.info(`Placing MARKET ${side} order on ${symbol} for ${quantity}`)
    return client.submitNewOrder({
      quantity: quantity,
      side,
      symbol,
      type: 'MARKET',
    })
  }

  /**
   * Helper: rounds a number down to the nearest step size (e.g. 0.01).
   */
  private roundToStep(value: number, step: number): number {
    return Math.floor(value / step) * step
  }
}
