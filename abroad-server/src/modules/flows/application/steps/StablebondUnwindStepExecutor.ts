import { FlowStepType, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { CryptoInventoryService } from '../../../treasury/application/CryptoInventoryService'
import { JustInTimeUnwindService } from '../../../treasury/application/JustInTimeUnwindService'
import { AmountSource, amountSourceSchema, resolveAmount } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

const stablebondUnwindConfigSchema = z.object({
  amountSource: amountSourceSchema.optional(),
})

/**
 * Liquidates the Stablebond position just in time, immediately before the
 * delivery that needs it.
 *
 * This is the step that makes "the float earns until the moment it's spent"
 * literally true rather than a slogan. The position and the delivery inventory
 * live on the SAME Stellar account, so the unwind puts USDC exactly where
 * `CRYPTO_SEND` is about to spend it, in one ledger — there is no transfer
 * between venues and nothing to wait for.
 *
 * It converts only the shortfall. Inventory that already covers the delivery is
 * left alone, so an ordinary delivery pays no spread at all and the step costs
 * one balance read.
 *
 * Idempotent on (transactionId, stepOrder): the unwind service is keyed on the
 * same identity, so a retried step re-attaches to the execution already in
 * flight and reconciles it rather than selling a second time.
 */
@injectable()
export class StablebondUnwindStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.STABLEBOND_UNWIND
  private readonly logger: ScopedLogger

  constructor(
    @inject(JustInTimeUnwindService) private readonly unwindService: JustInTimeUnwindService,
    @inject(CryptoInventoryService) private readonly inventoryService: CryptoInventoryService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowStablebondUnwind' })
  }

  public async execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    const parsed = stablebondUnwindConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    const { runtime, stepOrder } = params
    const transactionId = runtime.context.transactionId
    if (!transactionId) {
      return { error: 'Stablebond unwind requires a transactionId', outcome: 'failed' }
    }

    // Disabled is a no-op, not a failure. A flow definition carrying this step
    // must keep delivering while the position is switched off.
    if (!this.unwindService.isEnabled()) {
      return { outcome: 'succeeded', output: { reason: 'position_disabled', unwound: false } }
    }

    const required = resolveAmount(
      runtime,
      parsed.data.amountSource as AmountSource | undefined,
      runtime.context.sourceAmount,
    )
    if (!Number.isFinite(required) || required <= 0) {
      return { error: 'Stablebond unwind amount must be positive', outcome: 'failed' }
    }

    // Bypass the cache: this read sizes the conversion, and a stale one would
    // under-convert and leave the delivery short.
    const inventory = await this.inventoryService.getAvailable({
      bypassCache: true,
      cryptoCurrency: runtime.context.cryptoCurrency,
      network: runtime.context.blockchain,
    })
    if (!inventory.success) {
      // An unreadable balance is not a zero balance. Without it the shortfall
      // cannot be sized, so there is nothing safe to convert.
      this.logger.error('Cannot size a just-in-time unwind: inventory is unreadable', {
        reason: inventory.reason,
        transactionId,
      })
      return { error: `inventory_unreadable:${inventory.reason}`, outcome: 'failed' }
    }

    const shortfall = required - inventory.available
    if (shortfall <= 0) {
      // The common case: liquid inventory already covers the delivery, so the
      // position keeps earning and this delivery pays no spread.
      return { outcome: 'succeeded', output: { reason: 'inventory_sufficient', unwound: false } }
    }

    const result = await this.unwindService.unwind({
      idempotencyKey: `flow:${transactionId}:${stepOrder}`,
      requiredUsdc: new Prisma.Decimal(String(shortfall)),
    })

    if (result.outcome === 'confirmed') {
      this.logger.info('Just-in-time unwind funded a delivery', {
        received: result.receivedAmount?.toFixed(),
        shortfall,
        spreadBps: result.spreadBps,
        transactionId,
      })
      return {
        outcome: 'succeeded',
        output: {
          receivedAmount: result.receivedAmount?.toNumber() ?? null,
          shortfall,
          spreadBps: result.spreadBps,
          unwound: true,
        },
      }
    }

    // Everything else fails the step rather than delivering short. A retry is
    // safe and is the intended recovery: the idempotency key re-attaches to the
    // existing execution and reconciles it read-only instead of re-selling.
    this.logger.error('Just-in-time unwind did not fund the delivery', {
      outcome: result.outcome,
      reason: result.reason,
      shortfall,
      transactionId,
    })
    return { error: `unwind_${result.outcome}:${result.reason}`, outcome: 'failed' }
  }
}
