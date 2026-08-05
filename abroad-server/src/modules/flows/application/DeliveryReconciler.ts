import { DeliveryAttemptStatus, FlowInstanceStatus, FlowStepStatus, Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { TransactionRepository } from '../../transactions/application/TransactionRepository'

/**
 * A prepared transaction cannot be included after its timebound lapses, so an
 * attempt still unconfirmed past that instant is provably dead. The skew is the
 * allowance for our clock disagreeing with the network's.
 */
const ABSENCE_CLOCK_SKEW_MS = 15_000

/**
 * Resolves deliveries whose submission never came back.
 *
 * A submission that times out leaves an attempt that may or may not have landed,
 * and until something decides which, the customer has paid and holds nothing.
 * That decision used to require an engineer with cluster access reading Horizon
 * by hand; on 2026-08-05 it took an afternoon and two false starts.
 *
 * Each unresolved attempt is looked up on chain. Confirmed, the delivery is
 * settled as if it had returned normally. Absent past its expiry, the attempt is
 * closed and the step released so the flow can try again — safely, because the
 * dead transaction can never be included afterwards. Anything still in doubt is
 * simply left for the next pass rather than guessed at.
 */
@injectable()
export class DeliveryReconciler {
  private cancelSleep: (() => void) | null = null
  private isRunning = false
  private readonly logger: ScopedLogger
  private loopPromise: null | Promise<void> = null
  private readonly pollIntervalMs: number
  private readonly repository: TransactionRepository

  public constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.IWalletHandlerFactory) private readonly walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'DeliveryReconciler' })
    this.repository = new TransactionRepository(dbProvider)
    const configured = Number(process.env.DELIVERY_RECONCILE_INTERVAL_MS)
    this.pollIntervalMs = Number.isInteger(configured) && configured > 0 ? configured : 30_000
  }

  public async runOnce(now = new Date()): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    const attempts = await prisma.deliveryAttempt.findMany({
      include: { transaction: { include: { quote: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 50,
      where: {
        // Only past the skew allowance: before that the transaction may still
        // be included, and calling it dead would risk a second delivery.
        expiresAt: { lt: new Date(now.getTime() - ABSENCE_CLOCK_SKEW_MS) },
        status: DeliveryAttemptStatus.SUBMITTED,
      },
    })

    for (const attempt of attempts) {
      try {
        await this.resolve(attempt, now)
      }
      catch (error) {
        // One stuck attempt must not stop the rest of the batch.
        this.logger.error('Could not resolve a delivery attempt', {
          attemptId: attempt.id,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
    }
  }

  public start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.loopPromise = this.loop()
  }

  public async stop(): Promise<void> {
    this.isRunning = false
    this.cancelSleep?.()
    if (this.loopPromise) await this.loopPromise
    this.loopPromise = null
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.runOnce()
      }
      catch (error) {
        this.logger.error('Delivery reconciliation pass failed', {
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }
      if (this.isRunning) await this.sleep(this.pollIntervalMs)
    }
  }

  private async markExpired(attemptId: string, transactionId: string, now: Date): Promise<void> {
    const prisma = await this.dbProvider.getClient()
    await prisma.deliveryAttempt.update({
      data: {
        failureCode: 'never_included',
        lastReconciledAt: now,
        status: DeliveryAttemptStatus.EXPIRED,
      },
      where: { id: attemptId },
    })

    // Release the step so the flow tries again. Safe precisely because the
    // previous transaction can no longer be included: a fresh attempt cannot
    // become a second payment.
    const step = await prisma.flowStepInstance.findFirst({
      orderBy: { stepOrder: 'asc' },
      where: {
        flowInstance: { transactionId },
        status: FlowStepStatus.FAILED,
        stepType: 'CRYPTO_SEND',
      },
    })
    if (!step) return

    await prisma.flowStepInstance.update({
      data: { endedAt: null, error: Prisma.JsonNull, status: FlowStepStatus.READY },
      where: { id: step.id },
    })
    await prisma.flowInstance.updateMany({
      data: { currentStepOrder: step.stepOrder, status: FlowInstanceStatus.IN_PROGRESS },
      where: { status: FlowInstanceStatus.FAILED, transactionId },
    })
    this.logger.info('Delivery attempt proved absent; released the step for another attempt', {
      attemptId,
      transactionId,
    })
  }

  private async resolve(
    attempt: {
      id: string
      transaction: { id: string, onChainId: null | string, quote: { network: string } }
      transactionHash: string
    },
    now: Date,
  ): Promise<void> {
    const prisma = await this.dbProvider.getClient()

    // Someone else already settled this delivery; nothing to decide.
    if (attempt.transaction.onChainId) {
      await prisma.deliveryAttempt.update({
        data: { lastReconciledAt: now, status: DeliveryAttemptStatus.CONFIRMED },
        where: { id: attempt.id },
      })
      return
    }

    const handler = this.walletHandlerFactory.getWalletHandler(
      attempt.transaction.quote.network as Parameters<IWalletHandlerFactory['getWalletHandler']>[0],
    )
    if (!handler.reconcileTransaction) {
      this.logger.warn('Delivery attempt cannot be reconciled on this network', {
        attemptId: attempt.id,
        network: attempt.transaction.quote.network,
      })
      return
    }

    const result = await handler.reconcileTransaction(attempt.transactionHash)

    if (result.outcome === 'confirmed') {
      await this.repository.recordOnChainIdIfMissing(prisma, attempt.transaction.id, attempt.transactionHash)
      await prisma.deliveryAttempt.update({
        data: {
          confirmedAt: now,
          lastReconciledAt: now,
          status: DeliveryAttemptStatus.CONFIRMED,
        },
        where: { id: attempt.id },
      })
      this.logger.info('Delivery attempt confirmed on chain during reconciliation', {
        attemptId: attempt.id,
        transactionId: attempt.transaction.id,
      })
      return
    }

    if (result.outcome === 'absent' || result.outcome === 'failed') {
      await this.markExpired(attempt.id, attempt.transaction.id, now)
      return
    }

    // 'unavailable' — the chain could not be read. Left untouched so the next
    // pass decides rather than guessing at a customer's money.
    await prisma.deliveryAttempt.update({
      data: { lastReconciledAt: now },
      where: { id: attempt.id },
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelSleep = null
        resolve()
      }, ms)
      this.cancelSleep = () => {
        clearTimeout(timer)
        this.cancelSleep = null
        resolve()
      }
    })
  }
}
