import { CryptoCurrency, FlowStepType } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { AmountSource, amountSourceSchema, resolveAmount } from '../flowAmountResolver'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

const enqueueBridgeConfigSchema = z.object({
  amountSource: amountSourceSchema.optional(),
  asset: z.string().min(2),
  destNetwork: z.string().min(2),
})

/**
 * Records the USDC a flow deposited at Binance as a PENDING bridge leg, to be
 * swept to Transfero in batches that clear the per-withdrawal minimum. The
 * user-facing settlement (the Transfero convert against the float) has already
 * happened, so this step does NO external call — it cannot hit the 5-USDC floor
 * and never parks the flow. Idempotent on (transactionId, stepOrder).
 */
@injectable()
export class EnqueueBridgeStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.ENQUEUE_BRIDGE
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowEnqueueBridge' })
  }

  public async execute(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    const parsed = enqueueBridgeConfigSchema.safeParse(params.config)
    if (!parsed.success) {
      return { error: parsed.error.message, outcome: 'failed' }
    }

    const config = parsed.data
    const { runtime, stepOrder } = params
    const amount = resolveAmount(runtime, config.amountSource as AmountSource | undefined, runtime.context.sourceAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: 'Bridge enqueue amount must be positive', outcome: 'failed' }
    }

    const transactionId = runtime.context.transactionId
    if (!transactionId) {
      return { error: 'Bridge enqueue requires a transactionId', outcome: 'failed' }
    }

    try {
      const client = await this.dbProvider.getClient()
      await client.bridgePendingTransfer.upsert({
        create: {
          amount,
          asset: config.asset as CryptoCurrency,
          destNetwork: config.destNetwork,
          stepOrder,
          transactionId,
        },
        // Idempotent: a re-run must neither double-enrol nor re-size the leg.
        update: {},
        where: { transactionId_stepOrder: { stepOrder, transactionId } },
      })

      this.logger.info('Enqueued bridge leg', {
        amount,
        asset: config.asset,
        destNetwork: config.destNetwork,
        stepOrder,
        transactionId,
      })

      return {
        outcome: 'succeeded',
        output: { amount, asset: config.asset, bridged: false, destNetwork: config.destNetwork },
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'enqueue_bridge_error'
      this.logger.error('Failed to enqueue bridge leg', error)
      return { error: message, outcome: 'failed' }
    }
  }
}
