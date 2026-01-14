import { Prisma, SupportedCurrency, TargetCurrency, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { getCorrelationId } from '../../../core/requestContext'
import { PaymentSentMessage, PaymentStatusUpdatedMessage, ReceivedCryptoTransactionMessage } from '../../../platform/messaging/queueSchema'
import { IWebhookNotifier, WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { PayoutStatusAdapterRegistry } from '../../payments/application/PayoutStatusAdapterRegistry'
import { isSupportedPaymentMethod } from '../../payments/application/supportedPaymentMethods'
import { IExchangeProviderFactory } from '../../treasury/application/contracts/IExchangeProviderFactory'
import { type RefundResult, RefundService } from './RefundService'
import { TransactionEventDispatcher } from './TransactionEventDispatcher'
import { TransactionWithRelations } from './transactionNotificationTypes'
import { RefundAttemptResult, RefundReservation } from './TransactionRepository'
import { TransactionRepository } from './TransactionRepository'
import { TransactionTransitionName } from './TransactionStateMachine'

@injectable()
export class TransactionWorkflow {
  private readonly dispatcher: TransactionEventDispatcher
  private readonly exchangeProviderFactory: IExchangeProviderFactory
  private readonly logger: ScopedLogger
  private readonly outboxDispatcher: OutboxDispatcher
  private readonly refundService: RefundService
  private readonly repository: TransactionRepository
  private readonly scopeLabel = '[TransactionWorkflow]'

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(PayoutStatusAdapterRegistry) private readonly payoutStatusAdapterRegistry: PayoutStatusAdapterRegistry,
    @inject(TYPES.IWalletHandlerFactory) walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.IExchangeProviderFactory) exchangeProviderFactory: IExchangeProviderFactory,
    @inject(TYPES.IWebhookNotifier) webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransactionWorkflow' })
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(outboxDispatcher, baseLogger)
    this.outboxDispatcher = outboxDispatcher
    this.refundService = new RefundService(walletHandlerFactory, baseLogger)
    this.exchangeProviderFactory = exchangeProviderFactory
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
    const transactionRecord = await this.repository.applyDepositReceived(prismaClient, {
      idempotencyKey: this.buildIdempotencyKey('deposit', message.onChainId),
      onChainId: message.onChainId,
      transactionId: message.transactionId,
    })

    if (!transactionRecord) {
      await this.handleNonAwaitingDeposit(prismaClient, message, scopedLogger)
      return
    }

    await this.dispatcher.notifyPartnerAndUser(
      transactionRecord,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'processing',
      { deliverNow: false, prismaClient },
    )

    const hasMismatchedAmount = message.amount < transactionRecord.quote.sourceAmount
    if (hasMismatchedAmount) {
      await this.handleWrongAmount(prismaClient, transactionRecord, message, scopedLogger)
      return
    }

    await this.processPayout(prismaClient, transactionRecord, message, scopedLogger)
  }

  public async handlePaymentSent(message: PaymentSentMessage): Promise<void> {
    const scopedLogger = this.logger.child({
      correlationId: getCorrelationId(),
      staticPayload: { targetCurrency: message.targetCurrency, transactionId: message.transactionId },
    })

    if (message.transactionId && await this.isExchangeHandoffRecorded(message.transactionId)) {
      scopedLogger.info('Skipping exchange handoff; already recorded', { transactionId: message.transactionId })
      return
    }

    try {
      const walletHandler = this.refundService.resolveWalletHandler(message.blockchain)
      const exchangeProvider = this.exchangeProviderFactory.getExchangeProviderForCapability?.({
        blockchain: message.blockchain,
        targetCurrency: message.targetCurrency,
      }) ?? this.exchangeProviderFactory.getExchangeProvider(message.targetCurrency)
      const addressResult = await exchangeProvider.getExchangeAddress({
        blockchain: message.blockchain,
        cryptoCurrency: message.cryptoCurrency,
      })
      if (!addressResult.success) {
        scopedLogger.error('Failed to resolve exchange address', { code: addressResult.code, reason: addressResult.reason })
        await this.outboxDispatcher.enqueueSlack(
          `${this.scopeLabel} Error resolving exchange address for ${message.cryptoCurrency} -> ${message.targetCurrency}; tx=${message.transactionId ?? 'n/a'} reason=${addressResult.reason ?? addressResult.code ?? 'unknown'}`,
          'payment-sent',
        )
        return
      }
      const { address, memo } = addressResult

      const { success, transactionId: exchangeTransactionId } = await walletHandler.send({
        address,
        amount: message.amount,
        cryptoCurrency: message.cryptoCurrency,
        memo,
      })

      if (!success) {
        await this.outboxDispatcher.enqueueSlack(
          `${this.scopeLabel} Error sending ${message.amount} ${message.cryptoCurrency} to exchange (${message.targetCurrency}); tx=${message.transactionId ?? 'n/a'} on-chain=${exchangeTransactionId ?? 'n/a'}`,
          'payment-sent',
        )
        return
      }

      const clientDb = await this.repository.getClient()
      await this.persistPendingConversions(clientDb, {
        amount: message.amount,
        cryptoCurrency: message.cryptoCurrency,
        targetCurrency: message.targetCurrency,
        transactionId: message.transactionId,
      })
    }
    catch (error) {
      const errorMessage = `Failed exchange handoff for ${message.amount} ${message.cryptoCurrency} -> ${message.targetCurrency}`
      scopedLogger.error(errorMessage, error)
      await this.outboxDispatcher.enqueueSlack(errorMessage, 'payment-sent')
      throw error
    }
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
    const transitionName: TransactionTransitionName = newStatus === TransactionStatus.PAYMENT_COMPLETED
      ? 'payment_completed'
      : 'payment_failed'

    const updatedTransaction = await this.applyTransition(prismaClient, {
      context: {
        externalId: message.externalId,
        providerStatus: message.status,
      },
      idempotencyKey: this.buildIdempotencyKey('provider', message.externalId, message.status),
      name: transitionName,
      transactionId: transaction.id,
    })

    if (!updatedTransaction) {
      scopedLogger.warn('Skipping provider status update due to invalid transition', {
        externalId: message.externalId,
        newStatus,
        transactionId: transaction.id,
      })
      return
    }

    await this.dispatcher.notifyPartnerAndUser(
      updatedTransaction,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'provider_status',
      { deliverNow: false, prismaClient },
    )

    if (newStatus === TransactionStatus.PAYMENT_COMPLETED) {
      await this.dispatcher.notifySlack(
        updatedTransaction,
        newStatus,
        {
          deliverNow: false,
          heading: 'Payment completed',
          notes: {
            provider: message.provider,
            providerAmount: message.amount,
            providerStatus: message.status,
          },
          prismaClient,
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
        deliverNow: false,
        heading: 'Payment failed',
        notes: {
          provider: message.provider,
          providerStatus: message.status,
        },
        prismaClient,
        trigger: 'PaymentStatusUpdated',
      },
    )

    if (!updatedTransaction.onChainId) {
      scopedLogger.info('No on-chain id stored; skipping refund after provider failure')
      return
    }

    try {
      await this.attemptRefund(prismaClient, {
        logger: scopedLogger,
        reason: 'provider_failed',
        refund: () => this.refundService.refundByOnChainId({
          amount: updatedTransaction.quote.sourceAmount,
          cryptoCurrency: updatedTransaction.quote.cryptoCurrency,
          network: updatedTransaction.quote.network,
          onChainId: updatedTransaction.onChainId as string,
        }),
        transactionId: updatedTransaction.id,
        trigger: 'provider_status',
      })
    }
    catch (error) {
      scopedLogger.error('Failed to refund after provider failure', error)
    }
  }

  private async applyTransition(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    params: {
      context?: Prisma.InputJsonValue
      data?: Prisma.TransactionUpdateInput
      idempotencyKey: string
      name: TransactionTransitionName
      transactionId: string
    },
  ): Promise<null | TransactionWithRelations> {
    return this.repository.applyTransition(prismaClient, params)
  }

  private async attemptRefund(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    params: {
      logger: ScopedLogger
      reason: string
      refund: () => Promise<RefundResult>
      transactionId: string
      trigger: string
    },
  ): Promise<void> {
    const idempotencyKey = this.buildIdempotencyKey('refund', params.transactionId)
    const reservation = await this.repository.reserveRefund(prismaClient, {
      idempotencyKey,
      reason: params.reason,
      transactionId: params.transactionId,
      trigger: params.trigger,
    })

    if (!this.shouldSendRefund(reservation, params.logger, params.transactionId)) {
      return
    }

    let refundResult: RefundResult
    try {
      refundResult = await params.refund()
    }
    catch (error) {
      params.logger.error('Refund attempt threw unexpected error', error)
      refundResult = { reason: error instanceof Error ? error.message : 'unknown_error', success: false }
    }

    if (!refundResult.success) {
      params.logger.warn('Refund attempt failed', {
        reason: refundResult.reason,
        transactionId: params.transactionId,
      })
    }

    try {
      await this.repository.recordRefundOutcome(prismaClient, {
        idempotencyKey,
        refundResult: this.normalizeRefundResult(refundResult),
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      params.logger.error('Failed to record refund outcome', error)
    }
  }

  private buildIdempotencyKey(...segments: Array<string | undefined>): string {
    return segments
      .filter((segment): segment is string => Boolean(segment && segment.trim()))
      .join('|')
  }

  private buildPendingConversionUpdates(
    cryptoCurrency: PaymentSentMessage['cryptoCurrency'],
    targetCurrency: PaymentSentMessage['targetCurrency'],
  ): Array<{ source: SupportedCurrency, symbol: string, target: SupportedCurrency }> {
    if (cryptoCurrency !== SupportedCurrency.USDC) return []
    if (targetCurrency === TargetCurrency.COP) {
      return [
        { source: SupportedCurrency.USDC, symbol: 'USDCUSDT', target: SupportedCurrency.USDT },
        { source: SupportedCurrency.USDT, symbol: 'USDTCOP', target: SupportedCurrency.COP },
      ]
    }
    if (targetCurrency === TargetCurrency.BRL) {
      return [{ source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL }]
    }
    return []
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

    await this.attemptRefund(prismaClient, {
      logger,
      reason: 'expired_transaction',
      refund: () => this.refundService.refundToSender(message),
      transactionId: transactionState.id,
      trigger: 'non_awaiting_deposit',
    })
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

    const updatedTransaction = await this.applyTransition(prismaClient, {
      context: {
        expectedAmount: transaction.quote.sourceAmount,
        receivedAmount: message.amount,
      },
      idempotencyKey: this.buildIdempotencyKey('wrong_amount', message.onChainId),
      name: 'wrong_amount',
      transactionId: transaction.id,
    })

    if (!updatedTransaction) {
      logger.warn('Skipping wrong-amount handling due to invalid transition', { transactionId: transaction.id })
      return
    }

    await this.dispatcher.notifyPartnerAndUser(
      updatedTransaction,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'wrong_amount',
      { deliverNow: false, prismaClient },
    )

    await this.attemptRefund(prismaClient, {
      logger,
      reason: 'wrong_amount',
      refund: () => this.refundService.refundToSender(message),
      transactionId: transaction.id,
      trigger: 'wrong_amount',
    })
  }

  private async isExchangeHandoffRecorded(transactionId: string): Promise<boolean> {
    const clientDb = await this.repository.getClient()
    const existing = await clientDb.transaction.findUnique({
      select: { exchangeHandoffAt: true },
      where: { id: transactionId },
    })
    return Boolean(existing?.exchangeHandoffAt)
  }

  private normalizeRefundResult(result: RefundResult): RefundAttemptResult {
    if (result.success) {
      return { success: true, transactionId: result.transactionId }
    }

    return {
      reason: result.reason,
      success: false,
      transactionId: result.transactionId,
    }
  }

  private async persistPendingConversions(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    params: {
      amount: number
      cryptoCurrency: PaymentSentMessage['cryptoCurrency']
      targetCurrency: PaymentSentMessage['targetCurrency']
      transactionId?: string
    },
  ): Promise<void> {
    const conversions = this.buildPendingConversionUpdates(params.cryptoCurrency, params.targetCurrency)
    const run = async (tx: typeof prismaClient) => {
      for (const conversion of conversions) {
        await tx.pendingConversions.upsert({
          create: {
            amount: params.amount,
            side: 'SELL',
            source: conversion.source,
            symbol: conversion.symbol,
            target: conversion.target,
          },
          update: {
            amount: { increment: params.amount },
          },
          where: {
            source_target: { source: conversion.source, target: conversion.target },
          },
        })
      }

      if (params.transactionId) {
        await this.repository.markExchangeHandoff(tx, params.transactionId)
      }
    }

    if (typeof (prismaClient as unknown as { $transaction?: unknown }).$transaction === 'function') {
      await (prismaClient as unknown as { $transaction: <T>(fn: (tx: typeof prismaClient) => Promise<T>) => Promise<T> }).$transaction(run)
    }
    else {
      await run(prismaClient)
    }
  }

  private async processPayout(
    prismaClient: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    transaction: TransactionWithRelations,
    message: ReceivedCryptoTransactionMessage,
    logger: ScopedLogger,
  ): Promise<void> {
    let paymentService: ReturnType<IPaymentServiceFactory['getPaymentService']>
    try {
      const basePaymentService = this.paymentServiceFactory.getPaymentService(transaction.quote.paymentMethod)
      paymentService = this.paymentServiceFactory.getPaymentServiceForCapability?.({
        paymentMethod: transaction.quote.paymentMethod,
        targetCurrency: transaction.quote.targetCurrency,
      }) ?? basePaymentService
    }
    catch (error) {
      logger.error('Unsupported payment method for payout', error)
      const failedTransaction = await this.applyTransition(prismaClient, {
        idempotencyKey: this.buildIdempotencyKey('payout', 'unsupported', transaction.id),
        name: 'payment_failed',
        transactionId: transaction.id,
      })

      if (!failedTransaction) {
        logger.warn('Failed to record unsupported payment method transition', { transactionId: transaction.id })
        return
      }
      await this.dispatcher.notifyPartnerAndUser(
        failedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'unsupported_payment_method',
        { deliverNow: false, prismaClient },
      )
      await this.attemptRefund(prismaClient, {
        logger,
        reason: 'unsupported_payment_method',
        refund: () => this.refundService.refundToSender(message),
        transactionId: transaction.id,
        trigger: 'payout',
      })
      return
    }

    if (!paymentService.isEnabled) {
      const updatedTransaction = await this.applyTransition(prismaClient, {
        idempotencyKey: this.buildIdempotencyKey('payout', 'disabled', transaction.id),
        name: 'payment_failed',
        transactionId: transaction.id,
      })

      if (!updatedTransaction) {
        logger.warn('Payment method disabled transition rejected', { transactionId: transaction.id })
        return
      }

      await this.dispatcher.notifyPartnerAndUser(
        updatedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'payment_disabled',
        { deliverNow: false, prismaClient },
      )

      await this.dispatcher.notifySlack(updatedTransaction, TransactionStatus.PAYMENT_FAILED, {
        deliverNow: false,
        heading: 'Payment failed',
        notes: { reason: 'Payment method disabled' },
        prismaClient,
        trigger: 'TransactionWorkflow',
      })

      await this.attemptRefund(prismaClient, {
        logger,
        reason: 'payment_disabled',
        refund: () => this.refundService.refundToSender(message),
        transactionId: transaction.id,
        trigger: 'payout',
      })
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

      const transitionName: TransactionTransitionName = paymentResponse.success ? 'payment_completed' : 'payment_failed'

      const updatedTransaction = await this.applyTransition(prismaClient, {
        context: {
          providerTransactionId: paymentResponse.transactionId ?? null,
          reason: paymentResponse.success ? undefined : paymentResponse.reason,
          sourceAddress: message.addressFrom,
          status: paymentResponse.success ? undefined : paymentResponse.code,
        },
        idempotencyKey: this.buildIdempotencyKey('payout', transitionName, paymentResponse.transactionId ?? transaction.id),
        name: transitionName,
        transactionId: transaction.id,
      })

      if (!updatedTransaction) {
        logger.warn('Skipping payout transition due to invalid state', {
          id: transaction.id,
          transitionName,
        })
        return
      }

      await this.dispatcher.notifyPartnerAndUser(
        updatedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'final',
        { deliverNow: false, prismaClient },
      )

      if (paymentResponse.success) {
        await this.dispatcher.notifySlack(updatedTransaction, newStatus, {
          deliverNow: false,
          notes: { sourceAddress: message.addressFrom },
          prismaClient,
          trigger: 'TransactionWorkflow',
        })
        if (isSupportedPaymentMethod(updatedTransaction.quote.paymentMethod)) {
          await this.dispatcher.publishPaymentSent(updatedTransaction)
        }
      }
      else {
        await this.dispatcher.notifySlack(updatedTransaction, newStatus, {
          deliverNow: false,
          notes: {
            providerTransactionId: paymentResponse.transactionId ?? 'not-provided',
            reason: paymentResponse.reason,
            status: paymentResponse.code,
          },
          prismaClient,
          trigger: 'TransactionWorkflow',
        })
        if (paymentResponse.code !== 'retriable') {
          await this.attemptRefund(prismaClient, {
            logger,
            reason: paymentResponse.reason ?? 'payout_failed',
            refund: () => this.refundService.refundToSender(message),
            transactionId: transaction.id,
            trigger: 'payout',
          })
        }
      }
    }
    catch (error) {
      logger.error('Payment processing error', error)
      const failedTransaction = await this.applyTransition(prismaClient, {
        context: {
          error: error instanceof Error ? error.message : 'unknown',
        },
        idempotencyKey: this.buildIdempotencyKey('payout', 'error', transaction.id),
        name: 'payment_failed',
        transactionId: transaction.id,
      })

      if (!failedTransaction) {
        logger.warn('Failed to record payout error transition', { transactionId: transaction.id })
        return
      }
      await this.dispatcher.notifyPartnerAndUser(
        failedTransaction,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'error',
        { deliverNow: false, prismaClient },
      )

      await this.attemptRefund(prismaClient, {
        logger,
        reason: error instanceof Error ? error.message : 'unknown_payout_error',
        refund: () => this.refundService.refundToSender(message),
        transactionId: transaction.id,
        trigger: 'payout',
      })
    }
  }

  private shouldSendRefund(
    reservation: RefundReservation,
    logger: ScopedLogger,
    transactionId: string,
  ): boolean {
    if (reservation.outcome === 'reserved') {
      return true
    }

    if (reservation.outcome === 'already_refunded') {
      logger.info('Skipping refund; already recorded', {
        refundOnChainId: reservation.refundOnChainId,
        transactionId,
      })
      return false
    }

    if (reservation.outcome === 'in_flight') {
      logger.info('Skipping refund; already in flight', {
        attempts: reservation.attempts,
        transactionId,
      })
      return false
    }

    logger.warn('Skipping refund; transaction missing', { transactionId })
    return false
  }
}
