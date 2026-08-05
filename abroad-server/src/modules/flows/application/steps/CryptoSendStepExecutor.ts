import { FlowStepType, PaymentMethod, TargetCurrency, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IWalletHandlerFactory } from '../../../payments/application/contracts/IWalletHandlerFactory'
import { TransactionEventDispatcher } from '../../../transactions/application/TransactionEventDispatcher'
import { TransactionRepository } from '../../../transactions/application/TransactionRepository'
import { TransactionWebhookRouter } from '../../../transactions/application/TransactionWebhookRouter'
import { FlowStepExecutionResult, FlowStepExecutor, FlowStepRuntimeContext } from '../flowTypes'
import { RefundCoordinator } from '../RefundCoordinator'

const SEND_RETRY_BASE_DELAY_MS = 30_000
const SEND_RETRY_MAX_DELAY_MS = 5 * 60_000

/**
 * Delivers the crypto a FIAT_TO_CRYPTO customer bought, from Abroad's own hot
 * wallet on the destination chain.
 *
 * The customer's fiat has already settled by the time this runs, so the only
 * acceptable outcomes are a confirmed on-chain send or an explicit failure that
 * routes to a refund. An ambiguous send is never retried blind: the durable
 * send path records the prepared transaction first so a repeat can reconcile
 * against the chain instead of paying twice.
 */
@injectable()
export class CryptoSendStepExecutor implements FlowStepExecutor {
  public readonly stepType = FlowStepType.CRYPTO_SEND
  private readonly dispatcher: TransactionEventDispatcher
  private readonly logger: ScopedLogger
  private readonly repository: TransactionRepository

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IWalletHandlerFactory) private readonly walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    @inject(TYPES.IOutboxDispatcher) outboxDispatcher: OutboxDispatcher,
    @inject(TransactionWebhookRouter)
    transactionWebhookRouter: TransactionWebhookRouter,
    @inject(RefundCoordinator) private readonly refundCoordinator: RefundCoordinator,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.dispatcher = new TransactionEventDispatcher(
      outboxDispatcher,
      transactionWebhookRouter,
      baseLogger,
    )
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowCryptoSend' })
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
    const prismaClient = await this.repository.getClient()

    const transaction = await prismaClient.transaction.findUnique({
      include: {
        partnerUser: { include: { partner: true } },
        quote: true,
      },
      where: { id: params.runtime.context.transactionId },
    })

    if (!transaction) {
      return { error: 'Transaction not found for crypto send', outcome: 'failed' }
    }

    // A delivery already recorded on chain must never be repeated, whatever
    // state the flow believes it is in.
    if (transaction.onChainId) {
      this.logger.info('Crypto delivery already recorded; not sending again', {
        transactionId: transaction.id,
      })
      return {
        outcome: 'succeeded',
        output: { onChainId: transaction.onChainId, replayed: true },
      }
    }

    const destinationAddress = transaction.destinationAddress
    if (!destinationAddress) {
      return { error: 'Transaction has no destination address', outcome: 'failed' }
    }

    const walletHandler = this.walletHandlerFactory.getWalletHandler(transaction.quote.network)

    try {
      const result = await walletHandler.send({
        address: destinationAddress,
        amount: transaction.quote.sourceAmount,
        cryptoCurrency: transaction.quote.cryptoCurrency,
      })

      if (result.success) {
        return this.completeDelivery(prismaClient, transaction, result.transactionId)
      }

      // An ambiguous send left an unconfirmed transaction on the network. It is
      // never retried here: reconciliation has to decide whether it landed.
      if (result.reconciliationRequired) {
        this.logger.error('Crypto delivery is ambiguous and needs reconciliation', {
          onChainId: result.transactionId,
          reason: result.reason,
          transactionId: transaction.id,
        })
        await this.repository.recordOnChainIdIfMissing(
          prismaClient,
          transaction.id,
          result.transactionId,
        )
        return {
          correlation: { transactionId: transaction.id },
          error: 'crypto_send_ambiguous',
          outcome: 'failed',
          output: { onChainId: result.transactionId, reason: result.reason ?? null },
        }
      }

      if (result.code === 'retriable' && params.attempt < params.maxAttempts) {
        const retryAt = this.nextRetryAt(params.attempt)
        this.logger.warn('Crypto delivery retry scheduled', {
          attempt: params.attempt,
          maxAttempts: params.maxAttempts,
          retryAt: retryAt.toISOString(),
          transactionId: transaction.id,
        })
        return {
          correlation: { transactionId: transaction.id },
          outcome: 'waiting',
          output: {
            retry: {
              attempt: params.attempt,
              maxAttempts: params.maxAttempts,
              nextAttemptAt: retryAt.toISOString(),
              reason: 'wallet_retriable',
            },
          },
          retryAt,
        }
      }

      return this.failDelivery(prismaClient, transaction, result.reason ?? 'wallet_send_failed')
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_error'
      this.logger.error('Crypto delivery threw before returning an outcome', {
        reason,
        transactionId: transaction.id,
      })
      return {
        correlation: { transactionId: transaction.id },
        error: 'crypto_send_indeterminate',
        outcome: 'failed',
        output: { reason },
      }
    }
  }

  private async completeDelivery(
    prismaClient: Awaited<ReturnType<TransactionRepository['getClient']>>,
    transaction: { id: string },
    onChainId: string | undefined,
  ): Promise<FlowStepExecutionResult> {
    if (!onChainId) {
      return { error: 'Wallet did not return an on-chain transaction id', outcome: 'failed' }
    }

    await this.repository.recordOnChainIdIfMissing(prismaClient, transaction.id, onChainId)

    const updated = await this.repository.applyTransition(prismaClient, {
      context: { onChainId },
      idempotencyKey: `flow:crypto-send:completed:${onChainId}`,
      name: 'payment_completed',
      transactionId: transaction.id,
    })

    if (!updated) {
      this.logger.warn('Crypto delivery transition rejected', { transactionId: transaction.id })
      return { error: 'Crypto delivery transition rejected', outcome: 'failed' }
    }

    await this.dispatcher.notifyPartnerAndUser(
      updated,
      WebhookEvent.TRANSACTION_UPDATED,
      'transaction.updated',
      'flow_crypto_send',
      { deliverNow: false, prismaClient },
    )
    await this.dispatcher.notifySlack(updated, TransactionStatus.PAYMENT_COMPLETED, {
      deliverNow: false,
      prismaClient,
      trigger: 'FlowCryptoSend',
    })

    return { outcome: 'succeeded', output: { onChainId } }
  }

  private async failDelivery(
    prismaClient: Awaited<ReturnType<TransactionRepository['getClient']>>,
    transaction: {
      id: string
      pixDepositId: null | string
      quote: { paymentMethod: PaymentMethod, targetCurrency: TargetCurrency }
    },
    reason: string,
  ): Promise<FlowStepExecutionResult> {
    const updated = await this.repository.applyTransition(prismaClient, {
      context: { reason },
      idempotencyKey: `flow:crypto-send:failed:${transaction.id}`,
      name: 'payment_failed',
      transactionId: transaction.id,
    })

    if (updated) {
      await this.dispatcher.notifyPartnerAndUser(
        updated,
        WebhookEvent.TRANSACTION_UPDATED,
        'transaction.updated',
        'flow_crypto_send',
        { deliverNow: false, prismaClient },
      )
    }

    // The customer's fiat settled before this step ran, so a failed delivery
    // leaves them paid-up with nothing to show for it. Give the money back,
    // exactly as a failed payout returns the crypto its sender put in.
    if (transaction.pixDepositId) {
      await this.refundCoordinator.refundFiatDeposit({
        paymentMethod: transaction.quote.paymentMethod,
        providerDepositId: transaction.pixDepositId,
        reason: 'delivery_failed',
        targetCurrency: transaction.quote.targetCurrency,
        transactionId: transaction.id,
        trigger: 'flow_crypto_send',
      })
    }
    else {
      // Nothing was collected through a deposit we can reverse; a human has to
      // decide what the customer is owed.
      this.logger.error('Crypto delivery failed with no deposit to refund', {
        reason,
        transactionId: transaction.id,
      })
    }

    return { error: reason, outcome: 'failed', output: { reason } }
  }

  private nextRetryAt(attempt: number): Date {
    const delay = Math.min(
      SEND_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
      SEND_RETRY_MAX_DELAY_MS,
    )
    return new Date(Date.now() + delay)
  }
}
