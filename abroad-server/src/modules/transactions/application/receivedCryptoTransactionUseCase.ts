import { TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ValidationError } from '../../../core/errors'
import { createScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { ReceivedCryptoTransactionMessage, ReceivedCryptoTransactionMessageSchema } from '../../../platform/messaging/queueSchema'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowOrchestrator } from '../../flows/application/FlowOrchestrator'
import { RefundCoordinator } from '../../flows/application/RefundCoordinator'
import { TransactionEventDispatcher } from './TransactionEventDispatcher'
import { TransactionRepository } from './TransactionRepository'

export interface IReceivedCryptoTransactionUseCase {
  process(rawMessage: unknown): Promise<void>
}

@injectable()
export class ReceivedCryptoTransactionUseCase implements IReceivedCryptoTransactionUseCase {
  private readonly dispatcher: TransactionEventDispatcher
  private readonly repository: TransactionRepository

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.FlowOrchestrator) private readonly orchestrator: FlowOrchestrator,
    @inject(RefundCoordinator) private readonly refundCoordinator: RefundCoordinator,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(outboxDispatcher, this.logger)
  }

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
      const prismaClient = await this.repository.getClient()
      const depositResult = await this.repository.applyDepositReceived(prismaClient, {
        idempotencyKey: `flow:deposit:${parsedMessage.onChainId}`,
        onChainId: parsedMessage.onChainId,
        transactionId: parsedMessage.transactionId,
      })

      if (!depositResult) {
        await this.handleNonAwaitingDeposit(prismaClient, parsedMessage, scopedLogger)
        return
      }

      const { transaction } = depositResult

      await this.dispatcher.notifyPartnerAndUser(
        transaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'deposit_received',
        { deliverNow: false, prismaClient },
      )

      const expectedAmount = transaction.quote.sourceAmount
      if (parsedMessage.amount < expectedAmount) {
        await this.handleWrongAmount(prismaClient, transaction.id, expectedAmount, parsedMessage, scopedLogger)
        return
      }

      await this.orchestrator.startFlow(transaction.id)
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

  private async handleNonAwaitingDeposit(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    message: ReceivedCryptoTransactionMessage,
    logger: ReturnType<typeof createScopedLogger>,
  ): Promise<void> {
    const state = await this.repository.findRefundState(message.transactionId)
    if (!state) {
      logger.warn('Received crypto for unknown transaction', {
        onChainId: message.onChainId,
        transactionId: message.transactionId,
      })
      return
    }

    if (state.status !== TransactionStatus.PAYMENT_EXPIRED) {
      logger.info('Skipping received crypto for non-expired transaction', {
        status: state.status,
        transactionId: state.id,
      })
      return
    }

    if (!state.onChainId) {
      await this.repository.recordOnChainIdIfMissing(prismaClient, state.id, message.onChainId)
    }

    if (state.refundOnChainId) {
      logger.info('Expired transaction already refunded; skipping', {
        refundOnChainId: state.refundOnChainId,
        transactionId: state.id,
      })
      return
    }

    await this.refundCoordinator.refundToSender({
      addressFrom: message.addressFrom,
      amount: message.amount,
      blockchain: message.blockchain,
      cryptoCurrency: message.cryptoCurrency,
      reason: 'expired_transaction',
      transactionId: state.id,
      trigger: 'non_awaiting_deposit',
    })
  }

  private async handleWrongAmount(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transactionId: string,
    expectedAmount: number,
    message: ReceivedCryptoTransactionMessage,
    logger: ReturnType<typeof createScopedLogger>,
  ): Promise<void> {
    logger.warn('Transaction amount does not match quote', {
      expectedAmount,
      receivedAmount: message.amount,
      transactionId,
    })

    const updated = await this.repository.applyTransition(prismaClient, {
      context: {
        expectedAmount,
        receivedAmount: message.amount,
      },
      idempotencyKey: `flow:wrong_amount:${message.onChainId}`,
      name: 'wrong_amount',
      transactionId,
    })

    if (!updated) {
      logger.warn('Skipping wrong-amount handling due to invalid transition', { transactionId })
      return
    }

    await this.dispatcher.notifyPartnerAndUser(
      updated,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'wrong_amount',
      { deliverNow: false, prismaClient },
    )

    await this.refundCoordinator.refundToSender({
      addressFrom: message.addressFrom,
      amount: message.amount,
      blockchain: message.blockchain,
      cryptoCurrency: message.cryptoCurrency,
      reason: 'wrong_amount',
      transactionId,
      trigger: 'wrong_amount',
    })
  }
}
