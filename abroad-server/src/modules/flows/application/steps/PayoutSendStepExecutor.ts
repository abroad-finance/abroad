import { FlowStepType, PaymentMethod, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import type { PaymentSendResult } from '../../../payments/application/contracts/IPaymentService'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../../payments/application/contracts/IPaymentServiceFactory'
import { TransactionEventDispatcher } from '../../../transactions/application/TransactionEventDispatcher'
import { TransactionRepository } from '../../../transactions/application/TransactionRepository'
import { TransactionWebhookRouter } from '../../../transactions/application/TransactionWebhookRouter'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'
import { RefundCoordinator } from '../RefundCoordinator'

const PAYOUT_RETRY_BASE_DELAY_MS = 65_000
const PAYOUT_RETRY_MAX_DELAY_MS = 5 * 60_000

@injectable()
export class PayoutSendStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.PAYOUT_SEND
  private readonly dispatcher: TransactionEventDispatcher
  private readonly logger: ScopedLogger
  private readonly refundCoordinator: RefundCoordinator
  private readonly repository: TransactionRepository

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TransactionWebhookRouter)
    transactionWebhookRouter: TransactionWebhookRouter,
    @inject(RefundCoordinator) refundCoordinator: RefundCoordinator,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(
      outboxDispatcher,
      transactionWebhookRouter,
      baseLogger,
    )
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowPayoutSend' })
    this.refundCoordinator = refundCoordinator
  }

  public async execute(params: {
    attempt: number
    config: Record<string, unknown>
    maxAttempts: number
    runtime: FlowStepRuntimeContext
    stepOrder: number
  }): Promise<FlowStepExecutionResult> {
    void params.config
    void params.stepOrder
    const { runtime } = params
    const prismaClient = await this.repository.getClient()

    const transaction = await prismaClient.transaction.findUnique({
      include: {
        partnerUser: { include: { partner: true } },
        quote: true,
      },
      where: { id: runtime.context.transactionId },
    })

    if (!transaction) {
      return { error: 'Transaction not found for payout', outcome: 'failed' }
    }

    const paymentMethod = this.resolvePaymentMethod(params.config, transaction.quote.paymentMethod)
    let paymentService = this.paymentServiceFactory.getPaymentService(paymentMethod)
    paymentService = this.paymentServiceFactory.getPaymentServiceForCapability?.({
      paymentMethod,
      targetCurrency: transaction.quote.targetCurrency,
    }) ?? paymentService

    if (!paymentService.isEnabled) {
      return { error: 'Payment method disabled', outcome: 'failed' }
    }

    try {
      const paymentResponse = await paymentService.sendPayment({
        account: transaction.accountNumber,
        id: transaction.id,
        qrCode: transaction.qrCode,
        value: transaction.quote.targetAmount,
      })

      if (paymentResponse.transactionId) {
        await this.repository.recordExternalIdIfMissing(prismaClient, transaction.id, paymentResponse.transactionId)
      }

      if (paymentService.isAsync && paymentResponse.success) {
        const externalId = paymentResponse.transactionId
        if (!externalId) {
          return { error: 'Payout provider did not return transaction id', outcome: 'failed' }
        }

        await this.repository.persistExternalId(prismaClient, transaction.id, externalId)

        return {
          correlation: { externalId },
          outcome: 'succeeded',
          output: {
            ...(paymentResponse.economics ? { economics: paymentResponse.economics } : {}),
            externalId,
            provider: paymentService.provider ?? paymentMethod,
          },
        }
      }

      if (paymentResponse.success && paymentResponse.transactionId) {
        await this.repository.persistExternalId(prismaClient, transaction.id, paymentResponse.transactionId)
      }

      if (this.shouldScheduleRetry(paymentResponse, params.attempt, params.maxAttempts)) {
        const retryAt = this.nextRetryAt(params.attempt)
        this.logger.warn('Payout retry scheduled', {
          attempt: params.attempt,
          maxAttempts: params.maxAttempts,
          retryAt: retryAt.toISOString(),
          transactionId: transaction.id,
        })
        return {
          correlation: { transactionId: transaction.id },
          outcome: 'waiting',
          output: {
            provider: paymentService.provider ?? paymentMethod,
            retry: {
              attempt: params.attempt,
              maxAttempts: params.maxAttempts,
              nextAttemptAt: retryAt.toISOString(),
              reason: 'provider_retriable',
            },
          },
          retryAt,
        }
      }

      const transitionName = paymentResponse.success ? 'payment_completed' : 'payment_failed'
      const updated = await this.repository.applyTransition(prismaClient, {
        context: {
          providerTransactionId: paymentResponse.transactionId ?? null,
          reason: paymentResponse.success ? undefined : paymentResponse.reason,
          status: paymentResponse.success ? undefined : paymentResponse.code,
        },
        idempotencyKey: `flow:payout:${transitionName}:${paymentResponse.transactionId ?? transaction.id}`,
        name: transitionName,
        transactionId: transaction.id,
      })

      const retryingFailedPayout = transitionName === 'payment_failed' && transaction.status === TransactionStatus.PAYMENT_FAILED
      if (!updated && !retryingFailedPayout) {
        this.logger.warn('Payout transition rejected', { transactionId: transaction.id, transitionName })
        return { error: 'Payout transition rejected', outcome: 'failed' }
      }

      const transactionForNotifications = updated ?? transaction

      if (updated) {
        await this.dispatcher.notifyPartnerAndUser(
          updated,
          WebhookEvent.TRANSACTION_UPDATED,
          'transaction.updated',
          'flow_payout',
          { deliverNow: false, prismaClient },
        )
      }

      if (paymentResponse.success) {
        await this.dispatcher.notifySlack(transactionForNotifications, TransactionStatus.PAYMENT_COMPLETED, {
          deliverNow: false,
          notes: { provider: paymentService.provider ?? paymentMethod },
          prismaClient,
          trigger: 'FlowPayoutSend',
        })
        return {
          outcome: 'succeeded',
          output: {
            ...(paymentResponse.economics ? { economics: paymentResponse.economics } : {}),
            provider: paymentService.provider ?? transaction.quote.paymentMethod,
          },
        }
      }

      await this.dispatcher.notifySlack(transactionForNotifications, TransactionStatus.PAYMENT_FAILED, {
        deliverNow: false,
        notes: {
          provider: paymentService.provider ?? paymentMethod,
          providerTransactionId: paymentResponse.transactionId ?? 'not-provided',
          reason: paymentResponse.reason,
          status: paymentResponse.code,
        },
        prismaClient,
        trigger: 'FlowPayoutSend',
      })

      if (!this.shouldRefund(paymentResponse)) {
        this.logger.info('Skipping refund for payout failure', {
          code: paymentResponse.code ?? null,
          reason: paymentResponse.reason ?? null,
          transactionId: transactionForNotifications.id,
        })
        return { error: paymentResponse.reason ?? 'payout_failed', outcome: 'failed' }
      }

      if (!transactionForNotifications.onChainId) {
        this.logger.warn('Skipping refund for payout failure; missing onChainId', {
          transactionId: transactionForNotifications.id,
        })
        return { error: paymentResponse.reason ?? 'payout_failed', outcome: 'failed' }
      }

      await this.refundCoordinator.refundByOnChainId({
        amount: transactionForNotifications.quote.sourceAmount,
        cryptoCurrency: transactionForNotifications.quote.cryptoCurrency,
        network: transactionForNotifications.quote.network,
        onChainId: transactionForNotifications.onChainId,
        reason: 'provider_failed',
        transactionId: transactionForNotifications.id,
        trigger: 'flow_payout_send',
      })

      return { error: paymentResponse.reason ?? 'payout_failed', outcome: 'failed' }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_payout_error'
      this.logger.error('Payout execution failed', error)
      return { error: message, outcome: 'failed' }
    }
  }

  private nextRetryAt(attempt: number): Date {
    const exponent = Math.max(0, attempt - 1)
    const delayMs = Math.min(PAYOUT_RETRY_BASE_DELAY_MS * 2 ** exponent, PAYOUT_RETRY_MAX_DELAY_MS)
    return new Date(Date.now() + delayMs)
  }

  private resolvePaymentMethod(config: Record<string, unknown>, fallback: PaymentMethod): PaymentMethod {
    const configValue = typeof config.paymentMethod === 'string' ? config.paymentMethod : null
    const normalized = configValue?.toUpperCase()
    const method = Object.values(PaymentMethod).find(value => value === normalized)
    return method ?? fallback
  }

  private shouldRefund(paymentResponse: PaymentSendResult): boolean {
    if (paymentResponse.success) {
      return false
    }
    return paymentResponse.code !== 'retriable' || !paymentResponse.transactionId
  }

  private shouldScheduleRetry(
    paymentResponse: PaymentSendResult,
    attempt: number,
    maxAttempts: number,
  ): boolean {
    return !paymentResponse.success
      && paymentResponse.code === 'retriable'
      && attempt < maxAttempts
  }
}
