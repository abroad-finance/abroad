import { PendingConversions, Prisma, PrismaClient } from '@prisma/client'
import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ValidationError } from '../../../../core/errors'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { BinanceBalanceUpdatedMessageSchema } from '../../../../platform/messaging/queueSchema'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

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
 *  2. The reservation runs under SERIALIZABLE isolation with bounded retries to tolerate
 *     write conflicts without surfacing them to the queue.
 *  3. Market orders are placed **after** the reservation commits. If the order fails we
 *     re‑credit the reserved amount in a compensating transaction so the balance remains
 *     consistent.
 *  4. We fetch balances **once** per callback to minimise API calls.
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

  private readonly baseRetryDelayMs = 75
  private readonly maxRetryDelayMs = 1200
  private readonly maxTransactionAttempts = 5

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
  private async onBalanceUpdated(message: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'BinanceBalanceUpdated queue',
    })

    const parsed = BinanceBalanceUpdatedMessageSchema.safeParse(message)
    if (!parsed.success) {
      scopedLogger.error('[BinanceBalanceUpdated queue]: Invalid message format', parsed.error)
      throw new ValidationError('Invalid binance balance update message', parsed.error.issues)
    }

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
        scopedLogger.info(`[BinanceBalanceUpdated queue]: ${pc.source} balance: ${available}`)

        // Keep 0‑decimals for stable‑coin pairs → use Math.floor
        const qty = Math.floor(Math.min(available, pc.amount))
        if (qty <= 0) continue

        scopedLogger.info(`[BinanceBalanceUpdated queue]: ${pc.source}→${pc.target} qty: ${qty}`)

        await this.processPendingConversion(scopedLogger, db, client!, pc, qty)
      }
    }
    catch (error) {
      scopedLogger.error('Error processing balance update:', error)
      throw error
    }
  }

  /**
   * Helper: places a market order.
   */
  private async placeMarketOrder(
    scopedLogger: ScopedLogger,
    client: MainClient,
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
  ) {
    scopedLogger.info(`[BinanceBalanceUpdated queue]: Placing market order: ${side} ${quantity} ${symbol}`)
    return client.submitNewOrder({
      quantity,
      side,
      symbol,
      type: 'MARKET',
    })
  }

  private async processPendingConversion(
    scopedLogger: ScopedLogger,
    db: PrismaClient,
    client: MainClient,
    pendingConversion: PendingConversions,
    qty: number,
  ): Promise<void> {
    const reserved = await this.withTransactionRetry(scopedLogger, async () =>
      db.$transaction(async (tx: Prisma.TransactionClient) => {
        const { count } = await tx.pendingConversions.updateMany({
          data: { amount: { decrement: qty } },
          where: {
            amount: { gte: qty },
            source: pendingConversion.source,
            target: pendingConversion.target,
          },
        })

        return count > 0
      }, { isolationLevel: 'Serializable' }),
    )

    if (!reserved) {
      scopedLogger.info(`[BinanceBalanceUpdated queue]: ${pendingConversion.source}→${pendingConversion.target} already processed by another consumer`)
      return
    }

    try {
      await this.placeMarketOrder(scopedLogger, client, pendingConversion.symbol, pendingConversion.side, qty)
      scopedLogger.info(`[BinanceBalanceUpdated queue]: Converted ${qty} ${pendingConversion.source} to ${pendingConversion.target}`)
    }
    catch (error) {
      scopedLogger.error(
        '[BinanceBalanceUpdated queue]: Market order failed, restoring reserved balance',
        error,
      )

      await this.withTransactionRetry(scopedLogger, async () =>
        db.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.pendingConversions.update({
            data: { amount: { increment: qty } },
            where: {
              source_target: {
                source: pendingConversion.source,
                target: pendingConversion.target,
              },
            },
          })
        }, { isolationLevel: 'Serializable' }),
      )

      throw error
    }
  }

  private async withTransactionRetry<T>(
    scopedLogger: ScopedLogger,
    operation: () => Promise<T>,
  ): Promise<T> {
    let attempt = 1
    let lastError: unknown

    while (attempt <= this.maxTransactionAttempts) {
      try {
        return await operation()
      }
      catch (error) {
        lastError = error
        if (!this.isRetryableTransactionError(error) || attempt === this.maxTransactionAttempts) {
          throw error
        }

        const delayMs = this.computeRetryDelay(attempt)
        scopedLogger.warn(
          '[BinanceBalanceUpdated queue]: Transaction conflict detected, retrying',
          { attempt, delayMs, message: this.getErrorMessage(error) },
        )
        await this.delay(delayMs)
      }

      attempt += 1
    }

    throw lastError ?? new Error('Exhausted transaction retries without an error instance')
  }

  private computeRetryDelay(attempt: number): number {
    const normalizedAttempt = Math.max(attempt, 1)
    const exponentialBackoff = this.baseRetryDelayMs * (2 ** (normalizedAttempt - 1))
    const jitter = Math.random() * this.baseRetryDelayMs
    return Math.min(exponentialBackoff + jitter, this.maxRetryDelayMs)
  }

  private getErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return undefined
  }

  private isRetryableTransactionError(error: unknown): boolean {
    const isKnownPrismaError = error instanceof Prisma.PrismaClientKnownRequestError
    if (isKnownPrismaError && error.code === 'P2034') {
      return true
    }

    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code
      if (code === 'P2034') return true
    }

    if (error instanceof Error && error.message.includes('write conflict')) {
      return true
    }

    return false
  }

  private async delay(durationMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), durationMs)
    })
  }
}
