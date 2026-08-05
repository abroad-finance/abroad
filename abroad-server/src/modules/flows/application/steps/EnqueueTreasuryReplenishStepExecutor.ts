import { CryptoCurrency, FlowStepType, Prisma, ReplenishLegStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'

/**
 * Records that a delivered onramp owes the hot wallet a top-up.
 *
 * This runs after the customer already has their crypto, so it must never fail
 * the flow: enrolment is a bookkeeping entry that the replenish worker batches
 * later. The (transactionId, stepOrder) uniqueness is the idempotency anchor —
 * a re-run of this step re-reads the existing leg instead of enrolling a second
 * one and buying the same money twice.
 */
@injectable()
export class EnqueueTreasuryReplenishStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.ENQUEUE_TREASURY_REPLENISH
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowEnqueueTreasuryReplenish' })
  }

  public async execute(params: {
    attempt: number
    config: Record<string, unknown>
    maxAttempts: number
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    void params.config
    const prismaClient = await this.dbProvider.getClient()
    const transactionId = params.runtime.context.transactionId

    const transaction = await prismaClient.transaction.findUnique({
      include: { quote: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return { error: 'Transaction not found for treasury replenish', outcome: 'failed' }
    }

    try {
      const request = await prismaClient.treasuryReplenishRequest.upsert({
        create: {
          asset: transaction.quote.cryptoCurrency as CryptoCurrency,
          destNetwork: transaction.quote.network,
          fiatAmount: transaction.quote.targetAmount,
          fiatCurrency: transaction.quote.targetCurrency,
          status: ReplenishLegStatus.PENDING,
          stepOrder: params.stepOrder,
          transactionId,
        },
        // A re-run must not disturb a leg the worker may already have batched.
        update: {},
        where: {
          transactionId_stepOrder: { stepOrder: params.stepOrder, transactionId },
        },
      })

      return {
        outcome: 'succeeded',
        output: { replenishRequestId: request.id, status: request.status },
      }
    }
    catch (error) {
      // The customer has already been paid. Losing the replenish enrolment is a
      // treasury reconciliation problem, not a reason to fail a settled
      // delivery, so this is surfaced loudly and the flow moves on.
      const reason = error instanceof Error ? error.message : 'unknown_error'
      this.logger.error('Could not enrol the treasury replenish leg for a delivered onramp', {
        prismaCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
        reason,
        transactionId,
      })
      return { outcome: 'succeeded', output: { enrolled: false, reason } }
    }
  }
}
