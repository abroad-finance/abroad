import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ValidationError } from '../../../core/errors'
import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { PaymentSentMessage, PaymentSentMessageSchema } from '../../../platform/messaging/queueSchema'
import { TransactionWorkflow } from '../../transactions/application/TransactionWorkflow'

export interface IPaymentSentUseCase {
  process(rawMessage: unknown): Promise<void>
}

@injectable()
export class PaymentSentUseCase implements IPaymentSentUseCase {
  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.TransactionWorkflow) private readonly workflow: TransactionWorkflow,
  ) { }

  public async process(rawMessage: unknown): Promise<void> {
    const logger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'PaymentSentUseCase',
    })
    const message = this.parseMessage(rawMessage, logger)
    if (!message) {
      throw new ValidationError('Invalid payment sent message')
    }

    try {
      await this.workflow.handlePaymentSent(message)
    }
    catch (error) {
      logger.error('[PaymentSent]: Failed to process payment sent message', error)
      throw error
    }
  }

  private parseMessage(msg: unknown, logger: ILogger): PaymentSentMessage | undefined {
    const parsed = PaymentSentMessageSchema.safeParse(msg)
    if (!parsed.success) {
      logger.error('[PaymentSent]: Invalid message format:', parsed.error)
      return undefined
    }

    return parsed.data
  }
}
