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
 * Idempotency strategy
 * --------------------
 *  1. Every conversion is guarded by a single atomic UPDATE (`amount >= :qty`) that
 *     reserves the quantity to convert. If the UPDATE affects **zero** rows we know that
 *     another consumer has already processed that slice and we skip the order.
 *  2. The UPDATE + order placement run inside a SERIALIZABLE DB transaction. When a
 *     failure occurs after the UPDATE but before the order placement the transaction is
 *     rolled back, restoring the previous `amount` so the job can be retried safely.
 *  3. We fetch balances **once** per callback to minimise API calls.
 *
 * ⚠️ This logic still assumes that:
 *   • Both trading pairs are enabled on the connected account.
 *   • The account has sufficient balance to satisfy the minimum notional & step‑size
 *     rules for each pair.
 *   • Market orders are acceptable for the conversion (they take taker fees).
 *
 * Consider enriching the logic with dynamic lot‑size/step‑size handling via `exchangeInfo`
 * and adding retry/back‑off in production scenarios.
 */
@injectable()
export class BinanceBalanceUpdatedController {
  constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
  ) {}

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
    let client: MainClient | null = null
    try {
      // --- Initialise REST client -------------------------------------------------------
      const [apiKey, apiSecret, apiUrl] = await Promise.all([
        this.secretManager.getSecret('BINANCE_API_KEY'),
        this.secretManager.getSecret('BINANCE_API_SECRET'),
        this.secretManager.getSecret('BINANCE_API_URL'),
      ])

      client = new MainClient({
        api_key: apiKey,
        api_secret: apiSecret,
        baseUrl: apiUrl,
      })

      // --- Fetch current balances ------------------------------------------------------
      const balances = await client.getBalances()

      const db = await this.dbClientProvider.getClient()
      const pending = await db.pendingConversions.findMany({
        where: { amount: { gt: 0 } },
      })

      for (const pc of pending) {
        const balanceRaw = balances.find(b => b.coin === pc.source)?.free ?? '0'
        const available = typeof balanceRaw === 'string' ? parseFloat(balanceRaw) : balanceRaw
        this.logger.info(`[BinanceBalanceUpdated queue]: ${pc.source} balance: ${available}`)

        // Keep 0‑decimals for stable‑coin pairs → use Math.floor
        const qty = Math.floor(Math.min(available, pc.amount))
        if (qty <= 0) continue

        this.logger.info(`[BinanceBalanceUpdated queue]: ${pc.source}→${pc.target} qty: ${qty}`)

        // ----------------- Idempotent conversion block -------------------------------
        await db.$transaction(async (tx) => {
          // 1️⃣ Reserve the quantity atomically. If another worker got it first the UPDATE returns 0.
          const { count } = await tx.pendingConversions.updateMany({
            data: { amount: { decrement: qty } },
            where: {
              amount: { gte: qty },
              source: pc.source,
              target: pc.target,
            },
          })

          if (count === 0) {
            this.logger.info(`[BinanceBalanceUpdated queue]: ${pc.source}→${pc.target} already processed by another consumer`)
            return
          }

          // 2️⃣ Place the market order
          await this.placeMarketOrder(client!, pc.symbol, pc.side, qty)
          this.logger.info(`[BinanceBalanceUpdated queue]: Converted ${qty} ${pc.source} to ${pc.target}`)
        }, { isolationLevel: 'Serializable' })
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
    this.logger.info(`[BinanceBalanceUpdated queue]: Placing market order: ${side} ${quantity} ${symbol}`)
    return client.submitNewOrder({
      quantity,
      side,
      symbol,
      type: 'MARKET',
    })
  }
}
