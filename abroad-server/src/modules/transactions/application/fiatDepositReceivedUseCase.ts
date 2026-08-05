import { FlowDirection } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ValidationError } from '../../../core/errors'
import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { FiatDepositReceivedMessage, FiatDepositReceivedMessageSchema } from '../../../platform/messaging/queueSchema'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowOrchestrator } from '../../flows/application/FlowOrchestrator'
import { TransactionEventDispatcher } from './TransactionEventDispatcher'
import { TransactionRepository } from './TransactionRepository'
import { TransactionWebhookRouter } from './TransactionWebhookRouter'

export interface IFiatDepositReceivedUseCase {
  process(rawMessage: unknown): Promise<void>
}

@injectable()
export class FiatDepositReceivedUseCase implements IFiatDepositReceivedUseCase {
  private readonly dispatcher: TransactionEventDispatcher
  private readonly repository: TransactionRepository

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TransactionWebhookRouter)
    transactionWebhookRouter: TransactionWebhookRouter,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(
      outboxDispatcher,
      transactionWebhookRouter,
      this.logger,
    )
  }

  public async process(rawMessage: unknown): Promise<void> {
    const scopedLogger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: 'FiatDepositReceived',
    })

    const parsedMessage = this.parseMessage(rawMessage, scopedLogger)
    if (!parsedMessage) {
      throw new ValidationError('Invalid fiat deposit received message')
    }

    const prismaClient = await this.repository.getClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: { quote: true },
      where: { id: parsedMessage.transactionId },
    })

    if (!transaction) {
      // The provider credited us against an id we do not recognise. The money
      // is real, so this is an operations problem, not something to retry.
      scopedLogger.error('Fiat deposit credited an unknown transaction', {
        providerDepositId: parsedMessage.providerDepositId,
        transactionId: parsedMessage.transactionId,
      })
      return
    }

    if (transaction.quote.direction !== FlowDirection.FIAT_TO_CRYPTO) {
      scopedLogger.error('Fiat deposit credited a transaction that is not an onramp', {
        direction: transaction.quote.direction,
        transactionId: transaction.id,
      })
      return
    }

    // The deposit id is unique on Transaction, so a delivery replayed against a
    // different transaction is caught here rather than by a database error.
    if (transaction.pixDepositId && transaction.pixDepositId !== parsedMessage.providerDepositId) {
      scopedLogger.error('Fiat deposit does not match the deposit opened for this transaction', {
        transactionId: transaction.id,
      })
      return
    }

    if (parsedMessage.amount + AMOUNT_TOLERANCE < transaction.quote.targetAmount) {
      scopedLogger.error('Fiat deposit credited less than the quoted amount', {
        creditedAmount: parsedMessage.amount,
        quotedAmount: transaction.quote.targetAmount,
        transactionId: transaction.id,
      })
      return
    }

    const depositResult = await this.repository.applyFiatDepositReceived(prismaClient, {
      endToEndId: parsedMessage.endToEndId,
      idempotencyKey: `flow:fiat-deposit:${parsedMessage.providerDepositId}`,
      payerTaxId: parsedMessage.payerTaxId,
      providerDepositId: parsedMessage.providerDepositId,
      transactionId: parsedMessage.transactionId,
    })

    if (!depositResult) {
      scopedLogger.info('Fiat deposit did not move the transaction out of its current state', {
        transactionId: parsedMessage.transactionId,
      })
      return
    }

    if (!depositResult.transitionApplied) {
      scopedLogger.info('Fiat deposit already applied; not starting the flow again', {
        transactionId: parsedMessage.transactionId,
      })
      return
    }

    await this.dispatcher.notifyPartnerAndUser(
      depositResult.transaction,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'deposit_received',
      { deliverNow: false, prismaClient },
    )

    await this.orchestrator.startFlow(depositResult.transaction.id)
  }

  private parseMessage(
    rawMessage: unknown,
    logger: ReturnType<typeof createScopedLogger>,
  ): FiatDepositReceivedMessage | null {
    const parsed = FiatDepositReceivedMessageSchema.safeParse(rawMessage)
    if (!parsed.success) {
      logger.error('Invalid fiat deposit received message', {
        issues: parsed.error.issues,
      })
      return null
    }
    return parsed.data
  }
}

/**
 * BRL settles to two decimal places; this absorbs float representation noise
 * without admitting a genuine underpayment.
 */
const AMOUNT_TOLERANCE = 0.005
