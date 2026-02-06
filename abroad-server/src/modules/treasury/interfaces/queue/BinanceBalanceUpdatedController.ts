import { FlowStepStatus, FlowStepType } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ValidationError } from '../../../../core/errors'
import { createScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { getCorrelationId } from '../../../../core/requestContext'
import { IQueueHandler, QueueName } from '../../../../platform/messaging/queues'
import { BinanceBalanceUpdatedMessageSchema } from '../../../../platform/messaging/queueSchema'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { FlowOrchestrator } from '../../../flows/application/FlowOrchestrator'

/**
 * Listens for balance‑update events from Binance and emits flow signals
 * so waiting exchange steps can resume.
 */
@injectable()
export class BinanceBalanceUpdatedController {
  constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IQueueHandler) private readonly queueHandler: IQueueHandler,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
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

    try {
      const prisma = await this.dbProvider.getClient()
      const provider = 'binance'
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
        scopedLogger.info('[BinanceBalanceUpdated queue]: No waiting flow steps for provider', { provider })
        return
      }

      const errors: Error[] = []
      for (const step of waitingSteps) {
        const transactionId = step.flowInstance?.transactionId
        if (!transactionId) {
          scopedLogger.warn('[BinanceBalanceUpdated queue]: Missing transactionId for waiting step', { provider })
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
          scopedLogger.error('[BinanceBalanceUpdated queue]: Error updating flow for transaction', {
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
      scopedLogger.error('Error processing balance update signal', error)
      throw error
    }
  }
}
