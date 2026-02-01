import { FlowStepType, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { PayoutStatusAdapterRegistry } from '../../../payments/application/PayoutStatusAdapterRegistry'
import { TransactionEventDispatcher } from '../../../transactions/application/TransactionEventDispatcher'
import { TransactionRepository } from '../../../transactions/application/TransactionRepository'
import { RefundCoordinator } from '../RefundCoordinator'
import {
  FlowSignalInput,
  FlowStepExecutionResult,
  FlowStepExecutor,
  FlowStepRuntimeContext,
  FlowStepSignalResult,
} from '../flowTypes'

@injectable()
export class AwaitProviderStatusStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.AWAIT_PROVIDER_STATUS
  private readonly dispatcher: TransactionEventDispatcher
  private readonly logger: ScopedLogger
  private readonly repository: TransactionRepository

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(PayoutStatusAdapterRegistry) private readonly adapterRegistry: PayoutStatusAdapterRegistry,
    @inject(RefundCoordinator) private readonly refundCoordinator: RefundCoordinator,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(outboxDispatcher, baseLogger)
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowAwaitProviderStatus' })
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
      include: { quote: true, partnerUser: { include: { partner: true } } },
      where: { id: runtime.context.transactionId },
    })

    if (!transaction) {
      return { error: 'Transaction not found for provider status wait', outcome: 'failed' }
    }

    if (!transaction.externalId) {
      return { error: 'Transaction externalId missing for provider status wait', outcome: 'failed' }
    }

    return {
      correlation: { externalId: transaction.externalId },
      output: {
        externalId: transaction.externalId,
        provider: transaction.quote.paymentMethod,
      },
      outcome: 'waiting',
    }
  }

  public async handleSignal(params: {
    config: Record<string, unknown>
    runtime: FlowStepRuntimeContext
    signal: FlowSignalInput
    stepOrder: number
  }): Promise<FlowStepSignalResult> {
    void params.config
    void params.stepOrder
    const { runtime, signal } = params
    const prismaClient = await this.repository.getClient()

    const transaction = await prismaClient.transaction.findUnique({
      include: { quote: true, partnerUser: { include: { partner: true } } },
      where: { id: runtime.context.transactionId },
    })

    if (!transaction) {
      return { error: 'Transaction not found for provider status signal', outcome: 'failed' }
    }

    const externalId = transaction.externalId
    if (!externalId) {
      return { error: 'Transaction externalId missing for provider status signal', outcome: 'failed' }
    }

    if (signal.correlationKeys.externalId !== externalId) {
      return { correlation: { externalId }, outcome: 'waiting' }
    }

    const provider = typeof signal.payload.provider === 'string' ? signal.payload.provider : undefined
    const rawStatus = typeof signal.payload.status === 'string' ? signal.payload.status : undefined

    if (!provider || !rawStatus) {
      return { error: 'Provider status payload missing required fields', outcome: 'failed' }
    }

    const adapter = this.adapterRegistry.getAdapter(provider)
    const newStatus = adapter.mapStatus(rawStatus)

    if (newStatus === TransactionStatus.PROCESSING_PAYMENT) {
      return { correlation: { externalId }, outcome: 'waiting' }
    }

    const transitionName = newStatus === TransactionStatus.PAYMENT_COMPLETED
      ? 'payment_completed'
      : 'payment_failed'

    const updated = await this.repository.applyTransition(prismaClient, {
      context: {
        externalId,
        provider,
        providerStatus: rawStatus,
      },
      idempotencyKey: `flow:provider:${externalId}:${rawStatus}`,
      name: transitionName,
      transactionId: transaction.id,
    })

    if (!updated) {
      this.logger.warn('Provider status transition rejected', { externalId, rawStatus, transactionId: transaction.id })
      return { error: 'Provider status transition rejected', outcome: 'failed' }
    }

    await this.dispatcher.notifyPartnerAndUser(
      updated,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'flow_provider_status',
      { deliverNow: false, prismaClient },
    )

    if (newStatus === TransactionStatus.PAYMENT_COMPLETED) {
      await this.dispatcher.notifySlack(updated, newStatus, {
        deliverNow: false,
        heading: 'Payment completed',
        notes: {
          provider,
          providerStatus: rawStatus,
        },
        prismaClient,
        trigger: 'FlowAwaitProviderStatus',
      })
      return { outcome: 'succeeded' }
    }

    await this.dispatcher.notifySlack(updated, newStatus, {
      deliverNow: false,
      heading: 'Payment failed',
      notes: {
        provider,
        providerStatus: rawStatus,
      },
      prismaClient,
      trigger: 'FlowAwaitProviderStatus',
    })

    if (updated.onChainId) {
      await this.refundCoordinator.refundByOnChainId({
        amount: updated.quote.sourceAmount,
        cryptoCurrency: updated.quote.cryptoCurrency,
        network: updated.quote.network,
        onChainId: updated.onChainId,
        reason: 'provider_failed',
        transactionId: updated.id,
        trigger: 'flow_provider_status',
      })
    }

    return { error: 'Provider reported payment failure', outcome: 'failed' }
  }
}
