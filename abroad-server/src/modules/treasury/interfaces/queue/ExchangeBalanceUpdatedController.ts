import { FlowStepStatus, FlowStepType } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ValidationError } from '../../../../core/errors'
import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { ExchangeBalanceUpdatedMessageSchema } from '../../../../platform/messaging/queueSchema'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { FlowOrchestrator } from '../../../flows/application/FlowOrchestrator'

/**
 * Listens for exchange balance updates (any exchange) and emits flow signals
 * so waiting `AWAIT_EXCHANGE_BALANCE` steps can resume.
 *
 * This is intentionally coarse-grained today (correlated primarily by provider),
 * so it should be hardened with more specific correlation keys once available.
 */
@injectable()
export class ExchangeBalanceUpdatedController {
  constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public registerConsumers(): void {
    this.logger.info(
      '[ExchangeBalanceUpdated queue]: Registering consumer for queue:',
      QueueName.EXCHANGE_BALANCE_UPDATED,
    )
    void this.queueHandler.subscribeToQueue(
      QueueName.EXCHANGE_BALANCE_UPDATED,
      this.onBalanceUpdated.bind(this),
    ).catch((error) => {
      this.logger.error('[ExchangeBalanceUpdated queue]: Error in consumer registration:', error)
    })
  }

  private async onBalanceUpdated(message: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'ExchangeBalanceUpdated queue',
    })

    const parsed = ExchangeBalanceUpdatedMessageSchema.safeParse(message)
    if (!parsed.success) {
      scopedLogger.error('[ExchangeBalanceUpdated queue]: Invalid message format', parsed.error)
      throw new ValidationError('Invalid exchange balance update message', parsed.error.issues)
    }

    const provider = parsed.data.provider

    try {
      const prisma = await this.dbProvider.getClient()
      const waitingSteps = await prisma.flowStepInstance.findMany({
        distinct: ['flowInstanceId'],
        select: { flowInstance: { select: { transactionId: true } } },
        where: {
          correlation: { path: ['provider'], equals: provider },
          status: FlowStepStatus.WAITING,
          stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
        },
      })

      if (waitingSteps.length === 0) {
        scopedLogger.info('[ExchangeBalanceUpdated queue]: No waiting flow steps for provider', { provider })
        return
      }

      const errors: Error[] = []
      for (const step of waitingSteps) {
        const transactionId = step.flowInstance?.transactionId
        if (!transactionId) {
          scopedLogger.warn('[ExchangeBalanceUpdated queue]: Missing transactionId for waiting step', { provider })
          continue
        }

        try {
          await this.orchestrator.handleSignal({
            correlationKeys: { provider },
            eventType: 'exchange.balance.updated',
            payload: { provider },
            transactionId,
          })
        }
        catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error))
          errors.push(normalized)
          scopedLogger.error('[ExchangeBalanceUpdated queue]: Error updating flow for transaction', {
            error: normalized,
            transactionId,
          })
        }
      }

      if (errors.length > 0) {
        throw errors[0]
      }
    }
    catch (error) {
      scopedLogger.error('Error processing exchange balance update signal', error)
      throw error
    }
  }
}

