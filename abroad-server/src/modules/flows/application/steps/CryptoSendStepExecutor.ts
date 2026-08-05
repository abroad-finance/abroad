import {
  BlockchainNetwork,
  CryptoCurrency,
  DeliveryAttemptStatus,
  FlowStepType,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { WebhookEvent } from '../../../../platform/notifications/IWebhookNotifier'
import { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { IWalletHandler, WalletSendParams, WalletSendResult } from '../../../payments/application/contracts/IWalletHandler'
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
    @inject(TYPES.IOutboxDispatcher) private readonly outboxDispatcher: OutboxDispatcher,
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

    // A delivery already CONFIRMED on chain must never be repeated, whatever
    // state the flow believes it is in. `onChainId` is now written only on
    // confirmation — a prepared-but-unconfirmed hash lives on DeliveryAttempt.
    // While both shared this field, a retry after a submission timeout took
    // this branch and reported success for a transaction that never landed.
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

    const sendParams = {
      address: destinationAddress,
      amount: transaction.quote.sourceAmount,
      // Escalates the inclusion bid on chains that auction block space, so a
      // retry after an outbid timeout does not simply lose again.
      attempt: params.attempt,
      cryptoCurrency: transaction.quote.cryptoCurrency,
    }

    try {
      // Durable send where the chain supports it: the signed envelope and its
      // expiry are persisted BEFORE broadcast, so a submission that times out
      // is resolvable rather than a mystery. Past the expiry the transaction
      // can never be included, which is what makes a further attempt safe.
      const result = walletHandler.sendDurably
        ? await this.sendDurably(prismaClient, walletHandler, transaction, sendParams, params.attempt)
        : await walletHandler.send(sendParams)

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
        // A customer has paid and is waiting, and this state needs a human to
        // resolve. Logging it at ERROR was not enough: two deliveries failed
        // this way on 2026-08-05 and nobody knew until someone read the logs.
        await this.raiseDeliveryAlert(
          `Onramp delivery unresolved for transaction ${transaction.id}: ${result.reason ?? 'unknown'}.`
          + ` Prepared ${result.transactionId ?? 'unknown'} on ${transaction.quote.network};`
          + ` attempt ${params.attempt} of ${params.maxAttempts}. The customer has paid and holds nothing.`,
        )
        // Deliberately NOT written to transaction.onChainId. That field means
        // "delivered", and writing an unconfirmed hash into it made the
        // short-circuit above report success for a transaction that never
        // landed — a silent total loss for a customer who had already paid.
        // The hash lives on the DeliveryAttempt until reconciliation decides.
        return {
          correlation: { transactionId: transaction.id },
          error: 'crypto_send_ambiguous',
          outcome: 'failed',
          output: { preparedHash: result.transactionId, reason: result.reason ?? null },
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

      await this.raiseDeliveryAlert(
        `Onramp delivery failed for transaction ${transaction.id}: ${result.reason ?? 'wallet_send_failed'}.`
        + ' Refunding the customer\'s deposit.',
      )
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

  private async raiseDeliveryAlert(message: string): Promise<void> {
    try {
      await this.outboxDispatcher.enqueueSlack(message, 'crypto_send_alert')
    }
    catch (error) {
      // Never let the alert be the thing that fails the step.
      this.logger.warn('Could not raise the crypto delivery alert', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  /**
   * Runs the wallet's durable send and records the attempt around it.
   *
   * The prepared envelope is written before broadcast, so a submission that
   * never returns still leaves something to reconcile against: the hash to
   * look up and the instant past which it can no longer be included. The
   * result is translated back into the ordinary send shape so the rest of the
   * step is indifferent to which path ran.
   */
  private async sendDurably(
    prismaClient: Awaited<ReturnType<TransactionRepository['getClient']>>,
    walletHandler: IWalletHandler,
    transaction: {
      id: string
      quote: { cryptoCurrency: CryptoCurrency, network: BlockchainNetwork, sourceAmount: number }
    },
    sendParams: WalletSendParams,
    attemptNumber: number,
  ): Promise<WalletSendResult> {
    const durable = await walletHandler.sendDurably!(sendParams, async (prepared) => {
      await prismaClient.deliveryAttempt.upsert({
        create: {
          amount: new Prisma.Decimal(prepared.amount),
          asset: transaction.quote.cryptoCurrency,
          attemptNumber,
          expiresAt: prepared.expiresAt,
          network: transaction.quote.network,
          signedEnvelopeXdr: prepared.signedEnvelopeXdr,
          status: DeliveryAttemptStatus.PREPARED,
          transactionHash: prepared.transactionId,
          transactionId: transaction.id,
        },
        // A replayed step must not open a second attempt under one number.
        update: { expiresAt: prepared.expiresAt, transactionHash: prepared.transactionId },
        where: {
          transactionId_attemptNumber: { attemptNumber, transactionId: transaction.id },
        },
      })
    })

    if (durable.outcome === 'confirmed') {
      await prismaClient.deliveryAttempt.updateMany({
        data: { confirmedAt: new Date(), status: DeliveryAttemptStatus.CONFIRMED, submittedAt: new Date() },
        where: { transactionHash: durable.transactionId },
      })
      return { success: true, transactionId: durable.transactionId }
    }

    // Submitted but unresolved. It stays SUBMITTED until reconciliation proves
    // it landed or lets it expire; nothing here writes onChainId.
    await prismaClient.deliveryAttempt.updateMany({
      data: {
        failureCode: durable.reason,
        status: DeliveryAttemptStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      where: { transactionHash: durable.transactionId },
    })
    return {
      code: 'retriable',
      reason: durable.reason,
      reconciliationRequired: true,
      success: false,
      transactionId: durable.transactionId,
    }
  }
}
