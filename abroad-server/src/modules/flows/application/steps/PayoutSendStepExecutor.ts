import { FlowStepType, PaymentMethod, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../../../payments/application/contracts/IPaymentServiceFactory'
import { TransactionEventDispatcher } from '../../../transactions/application/TransactionEventDispatcher'
import { TransactionRepository } from '../../../transactions/application/TransactionRepository'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'
import { RefundCoordinator } from '../RefundCoordinator'

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
    @inject(RefundCoordinator) refundCoordinator: RefundCoordinator,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(outboxDispatcher, baseLogger)
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowPayoutSend' })
    this.refundCoordinator = refundCoordinator
  }

  public async execute(params: {
    config: Record<string, unknown>
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

      if (paymentService.isAsync) {
        if (!paymentResponse.success) {
          return { error: paymentResponse.reason ?? 'payout_failed', outcome: 'failed' }
        }

        const externalId = paymentResponse.transactionId
        if (!externalId) {
          return { error: 'Payout provider did not return transaction id', outcome: 'failed' }
        }

        await this.repository.persistExternalId(prismaClient, transaction.id, externalId)

        return {
          correlation: { externalId },
          outcome: 'succeeded',
          output: {
            externalId,
            provider: paymentService.provider ?? paymentMethod,
          },
        }
      }

      if (paymentResponse.success && paymentResponse.transactionId) {
        await this.repository.persistExternalId(prismaClient, transaction.id, paymentResponse.transactionId)
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

      if (!updated) {
        this.logger.warn('Payout transition rejected', { transactionId: transaction.id, transitionName })
        return { error: 'Payout transition rejected', outcome: 'failed' }
      }

      await this.dispatcher.notifyPartnerAndUser(
        updated,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'flow_payout',
        { deliverNow: false, prismaClient },
      )

      if (paymentResponse.success) {
        await this.dispatcher.notifySlack(updated, TransactionStatus.PAYMENT_COMPLETED, {
          deliverNow: false,
          notes: { provider: paymentService.provider ?? paymentMethod },
          prismaClient,
          trigger: 'FlowPayoutSend',
        })
        return { outcome: 'succeeded', output: { provider: paymentService.provider ?? transaction.quote.paymentMethod } }
      }

      await this.dispatcher.notifySlack(updated, TransactionStatus.PAYMENT_FAILED, {
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
          transactionId: updated.id,
        })
        return { error: paymentResponse.reason ?? 'payout_failed', outcome: 'failed' }
      }

      if (!updated.onChainId) {
        this.logger.warn('Skipping refund for payout failure; missing onChainId', {
          transactionId: updated.id,
        })
        return { error: paymentResponse.reason ?? 'payout_failed', outcome: 'failed' }
      }

      await this.refundCoordinator.refundByOnChainId({
        amount: updated.quote.sourceAmount,
        cryptoCurrency: updated.quote.cryptoCurrency,
        network: updated.quote.network,
        onChainId: updated.onChainId,
        reason: 'provider_failed',
        transactionId: updated.id,
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

  private resolvePaymentMethod(config: Record<string, unknown>, fallback: PaymentMethod): PaymentMethod {
    const configValue = typeof config.paymentMethod === 'string' ? config.paymentMethod : null
    const normalized = configValue?.toUpperCase()
    const method = Object.values(PaymentMethod).find(value => value === normalized)
    return method ?? fallback
  }

  private shouldRefund(paymentResponse: { code?: 'permanent' | 'retriable' | 'validation', success: boolean }): boolean {
    if (paymentResponse.success) {
      return false
    }
    return paymentResponse.code !== 'retriable'
  }
}
