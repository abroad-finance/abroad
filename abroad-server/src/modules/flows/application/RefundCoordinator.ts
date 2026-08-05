import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionEconomicCostKind,
  TransactionEconomicCostStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import type { FiatDepositRefundResult } from '../../payments/application/contracts/IFiatDepositService'
import type { RefundResult } from '../../transactions/application/RefundService'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { ILockManager } from '../../../platform/cacheLock/ILockManager'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IFiatDepositServiceFactory } from '../../payments/application/contracts/IFiatDepositServiceFactory'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { REFUND_LOCK_ACQUIRE_TIMEOUT_MS, refundLockKey } from '../../transactions/application/refundLock'
import { RefundService } from '../../transactions/application/RefundService'
import { TransactionRepository } from '../../transactions/application/TransactionRepository'

@injectable()
export class RefundCoordinator {
  private readonly logger: ScopedLogger
  private readonly refundService: RefundService
  private readonly repository: TransactionRepository

  constructor(
    @inject(TYPES.IDatabaseClientProvider) dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IWalletHandlerFactory) walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ILockManager) private readonly lockManager: ILockManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
    @inject(TYPES.IFiatDepositServiceFactory)
    private readonly fiatDepositServiceFactory: IFiatDepositServiceFactory,
  ) {
    this.repository = new TransactionRepository(dbProvider)
    this.refundService = new RefundService(walletHandlerFactory, baseLogger)
    this.logger = createScopedLogger(baseLogger, { scope: 'FlowRefundCoordinator' })
  }

  public async refundByOnChainId(params: {
    amount: number
    cryptoCurrency: CryptoCurrency
    network: BlockchainNetwork
    onChainId: string
    reason: string
    transactionId: string
    trigger: string
  }): Promise<void> {
    await this.lockManager.withLock(
      refundLockKey(params.transactionId),
      REFUND_LOCK_ACQUIRE_TIMEOUT_MS,
      async () => this.refundByOnChainIdWhileLocked(params),
    )
  }

  /**
   * Returns a settled fiat deposit to whoever paid it — the onramp counterpart
   * of refunding crypto to its sender.
   *
   * An onramp takes the customer's money before it delivers anything, so a
   * delivery that fails without this leaves them paid-up and empty-handed. It
   * shares the payout refund's lock, reservation and outcome recording so the
   * two directions cannot both act on one transaction, and so a retried step
   * cannot refund twice.
   */
  public async refundFiatDeposit(params: {
    paymentMethod: PaymentMethod
    providerDepositId: string
    reason: string
    targetCurrency: TargetCurrency
    transactionId: string
    trigger: string
  }): Promise<void> {
    await this.lockManager.withLock(
      refundLockKey(params.transactionId),
      REFUND_LOCK_ACQUIRE_TIMEOUT_MS,
      async () => this.refundFiatDepositWhileLocked(params),
    )
  }

  public async refundToSender(params: {
    addressFrom: string
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    reason: string
    transactionId: string
    trigger: string
  }): Promise<void> {
    await this.lockManager.withLock(
      refundLockKey(params.transactionId),
      REFUND_LOCK_ACQUIRE_TIMEOUT_MS,
      async () => this.refundToSenderWhileLocked(params),
    )
  }

  private async recordRefundFee(
    client: Awaited<ReturnType<TransactionRepository['getClient']>>,
    transactionId: string,
    networkFee: { amount: string, currency: string },
  ): Promise<void> {
    const transaction = await client.transaction.findUnique({
      select: { quote: true },
      where: { id: transactionId },
    })
    if (!transaction) return

    await client.transactionEconomics.upsert({
      create: {
        customerPayoutNative: new Prisma.Decimal(String(transaction.quote.targetAmount)),
        payoutCurrency: transaction.quote.targetCurrency,
        sourceAmountUsd: new Prisma.Decimal(String(transaction.quote.sourceAmount)),
        sourceCurrency: transaction.quote.cryptoCurrency,
        transactionId,
      },
      update: {},
      where: { transactionId },
    })
    await client.transactionEconomicCost.upsert({
      create: {
        kind: TransactionEconomicCostKind.REFUND_FEE,
        nativeAmount: new Prisma.Decimal(networkFee.amount),
        nativeCurrency: networkFee.currency,
        observedAt: new Date(),
        operationKey: TransactionEconomicCostKind.REFUND_FEE.toLowerCase(),
        status: TransactionEconomicCostStatus.PENDING,
        transactionId,
      },
      update: {
        nativeAmount: new Prisma.Decimal(networkFee.amount),
        nativeCurrency: networkFee.currency,
        observedAt: new Date(),
        reasonCode: null,
        status: TransactionEconomicCostStatus.PENDING,
      },
      where: {
        transactionId_kind_operationKey: {
          kind: TransactionEconomicCostKind.REFUND_FEE,
          operationKey: TransactionEconomicCostKind.REFUND_FEE.toLowerCase(),
          transactionId,
        },
      },
    })
  }

  private async refundByOnChainIdWhileLocked(params: {
    amount: number
    cryptoCurrency: CryptoCurrency
    network: BlockchainNetwork
    onChainId: string
    reason: string
    transactionId: string
    trigger: string
  }): Promise<void> {
    const prismaClient = await this.repository.getClient()
    const idempotencyKey = `flow:refund:${params.transactionId}:${params.reason}`
    const reservation = await this.repository.reserveRefund(prismaClient, {
      idempotencyKey,
      reason: params.reason,
      transactionId: params.transactionId,
      trigger: params.trigger,
    })

    if (reservation.outcome !== 'reserved') {
      this.logger.info('Skipping refund; already handled', {
        outcome: reservation.outcome,
        transactionId: params.transactionId,
      })
      return
    }

    let refundResult: RefundResult
    try {
      const sourceAddress = params.network === BlockchainNetwork.SOLANA
        ? await this.repository.findDepositAddressFrom(params.transactionId)
        : undefined

      refundResult = await this.refundService.refundByOnChainId({
        amount: params.amount,
        cryptoCurrency: params.cryptoCurrency,
        network: params.network,
        onChainId: params.onChainId,
        sourceAddress: sourceAddress ?? undefined,
      })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_refund_error'
      refundResult = { reason, success: false }
    }

    try {
      await this.repository.recordRefundOutcome(prismaClient, {
        idempotencyKey,
        refundResult: refundResult.success
          ? { success: true, transactionId: refundResult.transactionId }
          : refundResult.reconciliationRequired === true
            ? {
                reason: refundResult.reason,
                reconciliationRequired: true,
                success: false,
                transactionId: refundResult.transactionId,
              }
            : { reason: refundResult.reason, success: false, transactionId: refundResult.transactionId },
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      this.logger.error('Failed to record refund outcome', {
        error: error instanceof Error ? error.message : 'unknown_error',
        transactionId: params.transactionId,
      })
      return
    }
    if (refundResult.success && refundResult.networkFee) {
      try {
        await this.recordRefundFee(prismaClient, params.transactionId, refundResult.networkFee)
      }
      catch (error) {
        this.logger.warn('Refund completed but network fee capture was deferred', {
          error: error instanceof Error ? error.message : 'unknown_error',
          transactionId: params.transactionId,
        })
      }
    }
  }

  private async refundFiatDepositWhileLocked(params: {
    paymentMethod: PaymentMethod
    providerDepositId: string
    reason: string
    targetCurrency: TargetCurrency
    transactionId: string
    trigger: string
  }): Promise<void> {
    const prismaClient = await this.repository.getClient()
    const idempotencyKey = `flow:refund:${params.transactionId}:${params.reason}`
    const reservation = await this.repository.reserveRefund(prismaClient, {
      idempotencyKey,
      reason: params.reason,
      transactionId: params.transactionId,
      trigger: params.trigger,
    })

    if (reservation.outcome !== 'reserved') {
      this.logger.info('Skipping fiat refund; already handled', {
        outcome: reservation.outcome,
        transactionId: params.transactionId,
      })
      return
    }

    let result: FiatDepositRefundResult
    try {
      const depositService = this.fiatDepositServiceFactory.getForCapability({
        paymentMethod: params.paymentMethod,
        targetCurrency: params.targetCurrency,
      })
      result = await depositService.refundDeposit({
        providerDepositId: params.providerDepositId,
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_fiat_refund_error'
      result = { code: 'retriable', reason, success: false }
    }

    try {
      await this.repository.recordRefundOutcome(prismaClient, {
        idempotencyKey,
        // Every failure here is recorded as plainly failed, never as awaiting
        // reconciliation. A reservation left pending is never picked up again —
        // `reserveRefund` reports it as in-flight and the next attempt skips —
        // so parking a refund there strands the customer's money silently. That
        // is safe to avoid because the provider call carries an idempotency key
        // derived from the transaction: a retry after any failure, including one
        // that did reach the provider, cannot refund twice.
        refundResult: result.success
          ? { success: true, transactionId: result.providerRefundId }
          : { reason: result.reason, success: false },
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      this.logger.error('Failed to record fiat refund outcome', {
        error: error instanceof Error ? error.message : 'unknown_error',
        transactionId: params.transactionId,
      })
    }
  }

  private async refundToSenderWhileLocked(params: {
    addressFrom: string
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    reason: string
    transactionId: string
    trigger: string
  }): Promise<void> {
    const prismaClient = await this.repository.getClient()
    const idempotencyKey = `flow:refund:${params.transactionId}:${params.reason}`
    const reservation = await this.repository.reserveRefund(prismaClient, {
      idempotencyKey,
      reason: params.reason,
      transactionId: params.transactionId,
      trigger: params.trigger,
    })

    if (reservation.outcome !== 'reserved') {
      this.logger.info('Skipping refund; already handled', {
        outcome: reservation.outcome,
        transactionId: params.transactionId,
      })
      return
    }

    let refundResult: RefundResult
    try {
      refundResult = await this.refundService.refundToSender({
        addressFrom: params.addressFrom,
        amount: params.amount,
        blockchain: params.blockchain,
        cryptoCurrency: params.cryptoCurrency,
      })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown_refund_error'
      refundResult = { reason, success: false }
    }

    try {
      await this.repository.recordRefundOutcome(prismaClient, {
        idempotencyKey,
        refundResult: refundResult.success
          ? { success: true, transactionId: refundResult.transactionId }
          : refundResult.reconciliationRequired === true
            ? {
                reason: refundResult.reason,
                reconciliationRequired: true,
                success: false,
                transactionId: refundResult.transactionId,
              }
            : { reason: refundResult.reason, success: false, transactionId: refundResult.transactionId },
        transactionId: params.transactionId,
      })
    }
    catch (error) {
      this.logger.error('Failed to record refund outcome', {
        error: error instanceof Error ? error.message : 'unknown_error',
        transactionId: params.transactionId,
      })
      return
    }
    if (refundResult.success && refundResult.networkFee) {
      try {
        await this.recordRefundFee(prismaClient, params.transactionId, refundResult.networkFee)
      }
      catch (error) {
        this.logger.warn('Refund completed but network fee capture was deferred', {
          error: error instanceof Error ? error.message : 'unknown_error',
          transactionId: params.transactionId,
        })
      }
    }
  }
}
