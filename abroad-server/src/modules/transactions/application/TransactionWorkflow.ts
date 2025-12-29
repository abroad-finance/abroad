import { TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { PaymentStatusUpdatedMessage, ReceivedCryptoTransactionMessage } from '../../../platform/messaging/queueSchema'
import { ISlackNotifier } from '../../../platform/notifications/ISlackNotifier'
import { IWebhookNotifier, WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { PayoutStatusAdapterRegistry } from '../../payments/application/PayoutStatusAdapterRegistry'
import { isSupportedPaymentMethod } from '../../payments/application/supportedPaymentMethods'
import { TransactionEventDispatcher } from './TransactionEventDispatcher'
import { TransactionWithRelations } from './transactionNotificationTypes'
import { TransactionRepository } from './TransactionRepository'
import { TransactionStatusMapper } from './TransactionStatusMapper'

type RefundResult = { success: boolean, transactionId?: string }

@injectable()
export class TransactionWorkflow {
  private readonly dispatcher: TransactionEventDispatcher
  private readonly logger: ScopedLogger
  private readonly refundService: RefundService
  private readonly repository: TransactionRepository
  private readonly statusMapper = new TransactionStatusMapper()

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(PayoutStatusAdapterRegistry) private readonly payoutStatusAdapterRegistry: PayoutStatusAdapterRegistry,
    @inject(TYPES.IWalletHandlerFactory) walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.IQueueHandler) queueHandler: import('../../../platform/messaging/queues').IQueueHandler,
    @inject(TYPES.ISlackNotifier) slackNotifier: ISlackNotifier,
    @inject(TYPES.IWebhookNotifier) webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransactionWorkflow' })
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(outboxDispatcher, queueHandler, baseLogger)
    this.refundService = new RefundService(walletHandlerFactory, baseLogger)
  }

  public async handleIncomingDeposit(message: ReceivedCryptoTransactionMessage): Promise<void> {
    const scopedLogger = this.logger.child({
      correlationId: getCorrelationId(),
      staticPayload: {
        blockchain: message.blockchain,
        onChainId: message.onChainId,
        transactionId: message.transactionId,
      },
    })

    const prismaClient = await this.repository.getClient()
    const transactionRecord = await this.repository.markProcessingAwaiting(
      message.transactionId,
      message.onChainId,
    )

    if (!transactionRecord) {
      await this.handleNonAwaitingDeposit(prismaClient, message, scopedLogger)
      return
    }

    await this.dispatcher.notifyPartnerAndUser(
      transactionRecord,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'processing',
    )

    const hasMismatchedAmount = message.amount < transactionRecord.quote.sourceAmount
    if (hasMismatchedAmount) {
      await this.handleWrongAmount(prismaClient, transactionRecord, message, scopedLogger)
      return
    }

    await this.processPayout(prismaClient, transactionRecord, message, scopedLogger)
  }

  public async handleProviderStatusUpdate(
    message: PaymentStatusUpdatedMessage,
  ): Promise<void> {
    const scopedLogger = this.logger.child({
      correlationId: getCorrelationId(),
      staticPayload: {
        externalId: message.externalId,
        provider: message.provider,
        providerStatus: message.status,
      },
    })

    const transaction = await this.repository.findByExternalId(message.externalId)
    if (!transaction) {
      scopedLogger.warn('Provider status update received for unknown transaction')
      return
    }

    let paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>
    try {
      paymentService = this.paymentServiceFactory.getPaymentService(transaction.quote.paymentMethod)
    }
    catch (error) {
      scopedLogger.error('Unsupported payment method for provider status update', error)
      return
    }
    const adapter = this.payoutStatusAdapterRegistry.getAdapter(message.provider)
    const newStatus = adapter.mapStatus(message.status)

    if (newStatus === TransactionStatus.PROCESSING_PAYMENT) {
      scopedLogger.info('Provider status indicates processing; leaving transaction unchanged')
      return
    }

    const prismaClient = await this.repository.getClient()
    const updatedTransaction = await this.repository.updateStatus(prismaClient, transaction.id, newStatus)

    await this.dispatcher.notifyPartnerAndUser(
      updatedTransaction,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'provider_status',
    )

    if (newStatus === TransactionStatus.PAYMENT_COMPLETED) {
      await this.dispatcher.notifySlack(
        updatedTransaction,
        newStatus,
        {
          heading: 'Payment completed',
          notes: {
            provider: message.provider,
            providerAmount: message.amount,
            providerStatus: message.status,
          },
          trigger: 'PaymentStatusUpdated',
        },
      )

      if (paymentService.isAsync) {
        await this.dispatcher.publishPaymentSent(updatedTransaction)
      }
      return
    }

    await this.dispatcher.notifySlack(
      updatedTransaction,
      newStatus,
      {
        heading: 'Payment failed',
        notes: {
          provider: message.provider,
          providerStatus: message.status,
        },
        trigger: 'PaymentStatusUpdated',
      },
    )

    if (!updatedTransaction.onChainId) {
      scopedLogger.info('No on-chain id stored; skipping refund after provider failure')
      return
    }

    try {
      const refundResult = await this.refundService.refundByOnChainId({
        amount: updatedTransaction.quote.sourceAmount,
        cryptoCurrency: updatedTransaction.quote.cryptoCurrency,
        network: updatedTransaction.quote.network,
        onChainId: updatedTransaction.onChainId,
      })

      await this.recordRefundOnChainId(prismaClient, updatedTransaction.id, refundResult, scopedLogger)
    }
    catch (error) {
      scopedLogger.error('Failed to refund after provider failure', error)
    }
  }

  private async handleNonAwaitingDeposit(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    message: ReceivedCryptoTransactionMessage,
    logger: ScopedLogger,
  ): Promise<void> {
    const transactionState = await this.repository.findRefundState(message.transactionId)
    if (!transactionState) {
      logger.warn('Received crypto for unknown transaction', {
        onChainId: message.onChainId,
        transactionId: message.transactionId,
      })
      return
    }

    if (transactionState.status !== TransactionStatus.PAYMENT_EXPIRED) {
      logger.info('Skipping received crypto for non-expired transaction', {
        status: transactionState.status,
        transactionId: transactionState.id,
      })
      return
    }

    if (!transactionState.onChainId) {
      await this.repository.recordOnChainIdIfMissing(prismaClient, transactionState.id, message.onChainId)
    }

    if (transactionState.refundOnChainId) {
      logger.info('Expired transaction already refunded; skipping', {
        refundOnChainId: transactionState.refundOnChainId,
        transactionId: transactionState.id,
      })
      return
    }

    const refundResult = await this.refundService.refundToSender(message)
    await this.recordRefundOnChainId(prismaClient, transactionState.id, refundResult, logger)
  }

  private async handleWrongAmount(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transaction: TransactionWithRelations,
    message: ReceivedCryptoTransactionMessage,
    logger: ScopedLogger,
  ): Promise<void> {
    logger.warn(
      'Transaction amount does not match quote',
      {
        expectedAmount: transaction.quote.sourceAmount,
        receivedAmount: message.amount,
      },
    )

    const updatedTransaction = await this.repository.updateStatus(
      prismaClient,
      transaction.id,
      TransactionStatus.WRONG_AMOUNT,
    )

    await this.dispatcher.notifyPartnerAndUser(
      updatedTransaction,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'wrong_amount',
    )

    const refundResult = await this.refundService.refundToSender(message)
    await this.recordRefundOnChainId(prismaClient, transaction.id, refundResult, logger)
  }

  private async processPayout(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transaction: TransactionWithRelations,
    message: ReceivedCryptoTransactionMessage,
    logger: ScopedLogger,
  ): Promise<void> {
    let paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>
    try {
      paymentService = this.paymentServiceFactory.getPaymentService(
        transaction.quote.paymentMethod,
      )
    }
    catch (error) {
      logger.error('Unsupported payment method for payout', error)
      const failedTransaction = await this.repository.updateStatus(
        prismaClient,
        transaction.id,
        TransactionStatus.PAYMENT_FAILED,
      )
      await this.dispatcher.notifyPartnerAndUser(
        failedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'unsupported_payment_method',
      )
      const refundResult = await this.refundService.refundToSender(message)
      await this.recordRefundOnChainId(prismaClient, transaction.id, refundResult, logger)
      return
    }

    if (!paymentService.isEnabled) {
      const updatedTransaction = await this.repository.updateStatus(
        prismaClient,
        transaction.id,
        TransactionStatus.PAYMENT_FAILED,
      )

      await this.dispatcher.notifyPartnerAndUser(
        updatedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'payment_disabled',
      )

      await this.dispatcher.notifySlack(updatedTransaction, TransactionStatus.PAYMENT_FAILED, {
        heading: 'Payment failed',
        notes: { reason: 'Payment method disabled' },
        trigger: 'TransactionWorkflow',
      })

      const refundResult = await this.refundService.refundToSender(message)
      await this.recordRefundOnChainId(prismaClient, transaction.id, refundResult, logger)
      return
    }

    try {
      const paymentResponse = await paymentService.sendPayment({
        account: transaction.accountNumber,
        id: transaction.id,
        qrCode: transaction.qrCode,
        value: transaction.quote.targetAmount,
      })

      if (paymentResponse.success && paymentResponse.transactionId) {
        await this.repository.persistExternalId(prismaClient, transaction.id, paymentResponse.transactionId)
      }

      if (paymentService.isAsync && paymentResponse.success) {
        logger.info('Payment dispatched for async confirmation')
        return
      }

      const newStatus = paymentResponse.success
        ? TransactionStatus.PAYMENT_COMPLETED
        : TransactionStatus.PAYMENT_FAILED

      const updatedTransaction = await this.repository.updateStatus(
        prismaClient,
        transaction.id,
        newStatus,
      )

      await this.dispatcher.notifyPartnerAndUser(
        updatedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'final',
      )

      if (paymentResponse.success) {
        await this.dispatcher.notifySlack(updatedTransaction, newStatus, {
          notes: { sourceAddress: message.addressFrom },
          trigger: 'TransactionWorkflow',
        })
        if (isSupportedPaymentMethod(updatedTransaction.quote.paymentMethod)) {
          await this.dispatcher.publishPaymentSent(updatedTransaction)
        }
      }
      else {
        await this.dispatcher.notifySlack(updatedTransaction, newStatus, {
          notes: { providerTransactionId: paymentResponse.transactionId ?? 'not-provided' },
          trigger: 'TransactionWorkflow',
        })
        const refundResult = await this.refundService.refundToSender(message)
        await this.recordRefundOnChainId(prismaClient, transaction.id, refundResult, logger)
      }
    }
    catch (error) {
      logger.error('Payment processing error', error)
      const failedTransaction = await this.repository.updateStatus(
        prismaClient,
        transaction.id,
        TransactionStatus.PAYMENT_FAILED,
      )
      await this.dispatcher.notifyPartnerAndUser(
        failedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'error',
      )

      const refundResult = await this.refundService.refundToSender(message)
      await this.recordRefundOnChainId(prismaClient, transaction.id, refundResult, logger)
    }
  }

  private async recordRefundOnChainId(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transactionId: string,
    refundResult: RefundResult,
    logger: ScopedLogger,
  ): Promise<void> {
    if (!refundResult.success || !refundResult.transactionId) {
      logger.warn(
        'Refund transaction submission failed; no on-chain hash recorded',
        { transactionId },
      )
      return
    }

    try {
      await this.repository.recordRefundOnChainId(prismaClient, transactionId, refundResult.transactionId)
    }
    catch (error) {
      logger.error('Failed to persist refund transaction hash', error)
    }
  }
}

class RefundService {
  private readonly logger: ScopedLogger

  constructor(
    private readonly walletHandlerFactory: IWalletHandlerFactory,
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'RefundService' })
  }

  public async refundByOnChainId(params: {
    amount: number
    cryptoCurrency: Parameters<RefundService['refundToSender']>[0]['cryptoCurrency']
    network: Parameters<IWalletHandlerFactory['getWalletHandler']>[0]
    onChainId: string
  }): Promise<RefundResult> {
    const { amount, cryptoCurrency, network, onChainId } = params
    const walletHandler = this.walletHandlerFactory.getWalletHandler(network)
    const address = await walletHandler.getAddressFromTransaction({ onChainId })
    return walletHandler.send({ address, amount, cryptoCurrency })
  }

  public async refundToSender(
    message: ReceivedCryptoTransactionMessage,
  ): Promise<RefundResult> {
    const walletHandler = this.walletHandlerFactory.getWalletHandler(message.blockchain)
    return walletHandler.send({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
  }
}
