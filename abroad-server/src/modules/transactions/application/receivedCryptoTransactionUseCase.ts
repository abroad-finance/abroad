import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ValidationError } from '../../../core/errors'
import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { ReceivedCryptoTransactionMessage, ReceivedCryptoTransactionMessageSchema } from '../../../platform/messaging/queueSchema'
import { TransactionWorkflow } from './TransactionWorkflow'

export interface IReceivedCryptoTransactionUseCase {
  process(rawMessage: unknown): Promise<void>
}

@injectable()
export class ReceivedCryptoTransactionUseCase implements IReceivedCryptoTransactionUseCase {
  public constructor(
    @inject(TYPES.TransactionWorkflow) private readonly workflow: TransactionWorkflow,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) { }

  public async process(rawMessage: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'ReceivedCryptoTransaction',
    })

    const parsedMessage = this.parseMessage(rawMessage, scopedLogger)
    if (!parsedMessage) {
      throw new ValidationError('Invalid received crypto transaction message')
    }

    try {
      await this.workflow.handleIncomingDeposit(parsedMessage)
    }
    catch (error) {
      scopedLogger.error('Failed to process received crypto transaction', error)
      throw error
    }
  }

  private parseMessage(
    raw: unknown,
    scopedLogger: ReturnType<typeof createScopedLogger>,
  ): ReceivedCryptoTransactionMessage | undefined {
    const parsed = ReceivedCryptoTransactionMessageSchema.safeParse(raw)
    if (!parsed.success) {
      scopedLogger.error('Invalid message format', parsed.error)
      return undefined
    }
    return parsed.data
  }
}
