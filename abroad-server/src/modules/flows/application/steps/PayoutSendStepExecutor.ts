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
import { FlowStepExecutor, FlowStepExecutionResult, FlowStepRuntimeContext } from '../flowTypes'

@injectable()
export class PayoutSendStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.PAYOUT_SEND
  private readonly logger: ScopedLogger
  private readonly repository: TransactionRepository
  private readonly dispatcher: TransactionEventDispatcher

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory) private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(outboxDispatcher, baseLogger)
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowPayoutSend' })
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

      if (paymentResponse.success && paymentResponse.transactionId) {
        await this.repository.persistExternalId(prismaClient, transaction.id, paymentResponse.transactionId)
      }

      if (paymentService.isAsync) {
        return {
          correlation: paymentResponse.transactionId
            ? { externalId: paymentResponse.transactionId }
            : undefined,
          output: {
            externalId: paymentResponse.transactionId ?? null,
          provider: paymentService.provider ?? paymentMethod,
        },
        outcome: 'succeeded',
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
}
