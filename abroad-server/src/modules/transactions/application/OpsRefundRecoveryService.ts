import {
  BlockchainNetwork,
  Prisma,
  RefundReconciliationResult,
  RefundRecoveryAttemptStatus,
  RefundRecoveryStatus,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import type { IWalletHandler, WalletPreparedSend, WalletTransactionReconciliationResult } from '../../payments/application/contracts/IWalletHandler'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { ILockManager } from '../../../platform/cacheLock/ILockManager'
import { WebhookEvent } from '../../../platform/notifications/IWebhookNotifier'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { REFUND_LOCK_ACQUIRE_TIMEOUT_MS, refundLockKey } from './refundLock'
import { parseRefundTransition, refundHashFingerprint, RefundTransitionEvidence, resolveRefundAmount } from './refundRecoveryEvidence'
import { transactionNotificationInclude } from './transactionNotificationTypes'
import { toWebhookTransactionPayload } from './transactionPayload'
import { TransactionRepository } from './TransactionRepository'
import { TransactionWebhookRouter } from './TransactionWebhookRouter'

const ABSENCE_CLOCK_SKEW_MS = 15_000
const refundRelevantStatuses: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.PAYMENT_EXPIRED,
  TransactionStatus.PAYMENT_FAILED,
  TransactionStatus.WRONG_AMOUNT,
])

const recoverySnapshotSelect = {
  id: true,
  onChainId: true,
  origin: true,
  partnerUser: {
    select: {
      partner: { select: { id: true, webhookUrl: true } },
    },
  },
  quote: {
    select: {
      cryptoCurrency: true,
      network: true,
      sourceAmount: true,
    },
  },
  refundOnChainId: true,
  refundRecovery: {
    include: {
      attempts: { orderBy: { attemptNumber: 'asc' as const } },
    },
  },
  status: true,
  transitions: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      context: true,
      createdAt: true,
      event: true,
      idempotencyKey: true,
    },
    where: { event: { in: ['refund', 'wrong_amount'] } },
  },
} satisfies Prisma.TransactionSelect

export type OpsRefundRecoveryDto = {
  amount: null | number
  asset: string
  attempts: number
  blockReason: null | string
  candidateHashFingerprint: null | string
  canonicalRefundRecorded: boolean
  lastFailureCategory: null | string
  lastReconciliation: null | {
    at: Date
    result: 'ABSENT' | 'AMBIGUOUS' | 'BLOCKED' | 'CONFIRMED'
  }
  network: string
  replacementEligible: boolean
  status: OpsRefundRecoveryPosture
  transactionId: string
  version: number
}
export type OpsRefundRecoveryPosture
  = | 'AMBIGUOUS'
    | 'BLOCKED'
    | 'COMPLETED'
    | 'ELIGIBLE'
    | 'IN_FLIGHT'
    | 'NEEDS_RECONCILIATION'
    | 'NOT_REQUIRED'
    | 'UNSUPPORTED'
type CandidateResolution = {
  candidate: RecoveryCandidate
  failureCode: null | string
  outcome: 'absent' | 'ambiguous' | 'confirmed'
}
type DatabaseClient = Awaited<ReturnType<IDatabaseClientProvider['getClient']>> | Prisma.TransactionClient

type RecoveryAttempt = RecoveryRecord['attempts'][number]

type RecoveryCandidate = {
  attemptId: null | string
  expiresAt: Date
  hash: string
  status: null | RefundRecoveryAttemptStatus
}

type RecoveryRecord = NonNullable<RecoverySnapshot['refundRecovery']>

type RecoverySnapshot = Prisma.TransactionGetPayload<{ select: typeof recoverySnapshotSelect }>

type RecoveryWallet = IWalletHandler & {
  reconcileTransaction: NonNullable<IWalletHandler['reconcileTransaction']>
  sendDurably: NonNullable<IWalletHandler['sendDurably']>
}

class OpsRefundRecoveryNotFoundError extends ApplicationError {
  public constructor() {
    super(404, 'ops_refund_recovery_not_found', 'Transaction not found')
    this.name = 'OpsRefundRecoveryNotFoundError'
  }
}

class OpsRefundRecoveryValidationError extends ApplicationError {
  public constructor(message: string) {
    super(400, 'ops_refund_recovery_invalid', message)
    this.name = 'OpsRefundRecoveryValidationError'
  }
}

export class OpsRefundRecoveryConflictError extends ApplicationError {
  public constructor(message = 'Refund recovery changed; reconcile the latest state before continuing') {
    super(409, 'ops_refund_recovery_conflict', message)
    this.name = 'OpsRefundRecoveryConflictError'
  }
}

const supportsRecovery = (handler: IWalletHandler): handler is RecoveryWallet => (
  typeof handler.reconcileTransaction === 'function'
  && typeof handler.sendDurably === 'function'
)

@injectable()
export class OpsRefundRecoveryService {
  private readonly logger: ScopedLogger
  private readonly repository: TransactionRepository

  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IWalletHandlerFactory)
    private readonly walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ILockManager)
    private readonly lockManager: ILockManager,
    @inject(TransactionWebhookRouter)
    private readonly transactionWebhookRouter: TransactionWebhookRouter,
    @inject(TYPES.ILogger)
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'OpsRefundRecovery' })
    this.repository = new TransactionRepository(databaseClientProvider)
  }

  public async getStatus(transactionId: string): Promise<OpsRefundRecoveryDto> {
    return this.toDto(await this.loadSnapshot(transactionId))
  }

  public async issueReplacement(params: {
    expectedVersion: number
    initiatedByOpsUserId: string
    mutationIdempotencyKey: string
    transactionId: string
  }): Promise<OpsRefundRecoveryDto> {
    return this.lockManager.withLock(
      refundLockKey(params.transactionId),
      REFUND_LOCK_ACQUIRE_TIMEOUT_MS,
      async () => this.issueReplacementWhileLocked(params),
    )
  }

  public async reconcile(params: {
    expectedVersion: number
    transactionId: string
  }): Promise<OpsRefundRecoveryDto> {
    return this.lockManager.withLock(
      refundLockKey(params.transactionId),
      REFUND_LOCK_ACQUIRE_TIMEOUT_MS,
      async () => {
        const snapshot = await this.loadSnapshot(params.transactionId)
        this.assertVersion(snapshot, params.expectedVersion)

        if (snapshot.refundOnChainId) return this.toDto(snapshot)
        const context = this.actionContext(snapshot)
        const resolutions = await this.resolveCandidates(
          context.wallet,
          context.candidates,
          false,
        )

        return this.persistReconciliation({
          expectedVersion: params.expectedVersion,
          originalEvidence: context.evidence,
          originalHash: context.originalHash,
          originalHashExpiresAt: context.originalHashExpiresAt,
          resolutions,
          snapshot,
        })
      },
    )
  }

  private actionContext(snapshot: RecoverySnapshot): {
    amount: number
    candidates: RecoveryCandidate[]
    evidence: RefundTransitionEvidence
    originalHash: string
    originalHashExpiresAt: Date
    wallet: RecoveryWallet
  } {
    const dto = this.toDto(snapshot)
    if (dto.status === 'NOT_REQUIRED') {
      throw new OpsRefundRecoveryValidationError('This transaction does not require a refund')
    }
    if (dto.status === 'UNSUPPORTED') {
      throw new OpsRefundRecoveryValidationError('Refund recovery is not supported for this network')
    }
    if (dto.status === 'BLOCKED') {
      throw new OpsRefundRecoveryValidationError(dto.blockReason ?? 'Refund evidence is incomplete')
    }

    const evidence = this.refundEvidence(snapshot)
    const amount = this.refundAmount(snapshot, evidence)
    const recovery = snapshot.refundRecovery
    const persistedOriginalHash = recovery ? recovery.originalRefundHash : null
    const persistedOriginalExpiry = recovery ? recovery.originalHashExpiresAt : null
    const originalHash = persistedOriginalHash || (evidence ? evidence.candidateHash : null)
    const originalHashExpiresAt = persistedOriginalExpiry || (evidence ? evidence.originalHashExpiresAt : null)
    if (!evidence || amount === null || !originalHash || !originalHashExpiresAt) {
      throw new OpsRefundRecoveryValidationError('Refund evidence is incomplete')
    }

    const wallet = this.recoveryWallet(snapshot)
    return {
      amount,
      candidates: this.collectCandidates(snapshot, originalHash, originalHashExpiresAt),
      evidence,
      originalHash,
      originalHashExpiresAt,
      wallet,
    }
  }

  private assertLiveEvidence(
    snapshot: RecoverySnapshot,
    expectedEvidence: RefundTransitionEvidence,
  ): void {
    const liveEvidence = this.refundEvidence(snapshot)
    if (
      !liveEvidence
      || liveEvidence.idempotencyKey !== expectedEvidence.idempotencyKey
      || liveEvidence.attempts !== expectedEvidence.attempts
      || liveEvidence.candidateHash !== expectedEvidence.candidateHash
      || liveEvidence.status !== expectedEvidence.status
    ) {
      throw new OpsRefundRecoveryConflictError()
    }
  }

  private assertVersion(snapshot: RecoverySnapshot, expectedVersion: number): void {
    const currentVersion = snapshot.refundRecovery ? snapshot.refundRecovery.version : 1
    if (expectedVersion !== currentVersion) {
      throw new OpsRefundRecoveryConflictError()
    }
  }

  private attemptByHash(snapshot: RecoverySnapshot, transactionHash: string): RecoveryAttempt | undefined {
    return snapshot.refundRecovery?.attempts.find(attempt => attempt.transactionHash === transactionHash)
  }

  private blockReason(snapshot: RecoverySnapshot, evidence: null | RefundTransitionEvidence): null | string {
    if (!refundRelevantStatuses.has(snapshot.status) && !evidence && !snapshot.refundOnChainId) {
      return null
    }
    if (snapshot.quote.network !== BlockchainNetwork.STELLAR) {
      return 'Only Stellar refunds currently support durable operator recovery.'
    }
    if (!snapshot.onChainId) {
      return 'The original deposit hash is missing, so the refund destination cannot be derived safely.'
    }
    if (!evidence) {
      return 'No durable refund attempt is recorded for this transaction.'
    }
    if (evidence.status === 'succeeded' && !snapshot.refundOnChainId) {
      return 'The refund journal and canonical transaction record disagree.'
    }
    const persistedOriginalHash = snapshot.refundRecovery ? snapshot.refundRecovery.originalRefundHash : null
    if (!(persistedOriginalHash ?? evidence.candidateHash)) {
      return 'The original refund has no verifiable transaction hash; replacement is unsafe.'
    }
    if (this.refundAmount(snapshot, evidence) === null) {
      return 'The exact original deposit amount is not durably available for recovery.'
    }
    return null
  }

  private collectCandidates(
    snapshot: RecoverySnapshot,
    originalHash: string,
    originalHashExpiresAt: Date,
  ): RecoveryCandidate[] {
    const candidates: RecoveryCandidate[] = [{
      attemptId: null,
      expiresAt: originalHashExpiresAt,
      hash: originalHash,
      status: null,
    }]
    const hashes = new Set([originalHash])
    const recoveryAttempts = snapshot.refundRecovery ? snapshot.refundRecovery.attempts : []
    for (const attempt of recoveryAttempts) {
      if (hashes.has(attempt.transactionHash)) continue
      hashes.add(attempt.transactionHash)
      candidates.push({
        attemptId: attempt.id,
        expiresAt: attempt.expiresAt,
        hash: attempt.transactionHash,
        status: attempt.status,
      })
    }
    return candidates
  }

  private async completeRecovery(
    transaction: Prisma.TransactionClient,
    params: {
      evidence: RefundTransitionEvidence
      refundHash: string
      snapshot: RecoverySnapshot
      webhookTargets: readonly string[]
    },
  ): Promise<void> {
    await this.repository.recordRefundOutcome(transaction, {
      idempotencyKey: params.evidence.idempotencyKey,
      refundResult: { success: true, transactionId: params.refundHash },
      transactionId: params.snapshot.id,
    })

    const completed = await transaction.transaction.findUnique({
      include: transactionNotificationInclude,
      where: { id: params.snapshot.id },
    })
    if (!completed) throw new OpsRefundRecoveryNotFoundError()

    await this.transactionWebhookRouter.enqueueTargets(
      params.webhookTargets,
      { data: toWebhookTransactionPayload(completed), event: WebhookEvent.TRANSACTION_UPDATED },
      'ops_refund_recovery',
      {
        client: transaction,
        deliverNow: false,
        idempotencyKey: `refund-recovery:completed:${params.snapshot.id}:${params.refundHash}`,
        partnerId: params.snapshot.partnerUser.partner.id,
        primaryTarget: params.snapshot.partnerUser.partner.webhookUrl ?? undefined,
        transactionId: params.snapshot.id,
      },
    )
  }

  private failureCategory(snapshot: RecoverySnapshot, evidence: null | RefundTransitionEvidence): null | string {
    const persisted = snapshot.refundRecovery?.lastFailureCode
    if (persisted) {
      if (/rate.?limit|429/i.test(persisted)) return 'RATE_LIMIT'
      if (/timeout|408|504/i.test(persisted)) return 'NETWORK_TIMEOUT'
      if (/unavailable|5\d\d/i.test(persisted)) return 'PROVIDER_UNAVAILABLE'
      if (/rejected|failed|4\d\d/i.test(persisted)) return 'PROVIDER_REJECTED'
    }
    return evidence ? evidence.failureCategory : null
  }

  private async issueReplacementWhileLocked(params: {
    expectedVersion: number
    initiatedByOpsUserId: string
    mutationIdempotencyKey: string
    transactionId: string
  }): Promise<OpsRefundRecoveryDto> {
    const snapshot = await this.loadSnapshot(params.transactionId)
    this.assertVersion(snapshot, params.expectedVersion)
    const dto = this.toDto(snapshot)
    if (!dto.replacementEligible) {
      throw new OpsRefundRecoveryConflictError('Reconcile the original refund before issuing a replacement')
    }

    const context = this.actionContext(snapshot)
    const preflight = await this.resolveCandidates(context.wallet, context.candidates, true)
    if (preflight.some(result => result.outcome !== 'absent')) {
      return this.persistReconciliation({
        expectedVersion: params.expectedVersion,
        originalEvidence: context.evidence,
        originalHash: context.originalHash,
        originalHashExpiresAt: context.originalHashExpiresAt,
        resolutions: preflight,
        snapshot,
      })
    }

    const destination = await context.wallet.getAddressFromTransaction({ onChainId: snapshot.onChainId ?? undefined })
    if (!destination.trim()) {
      throw new OpsRefundRecoveryValidationError('The refund destination could not be derived from the original deposit')
    }

    let preparedVersion: null | number = null
    const sendResult = await context.wallet.sendDurably({
      address: destination,
      amount: context.amount,
      cryptoCurrency: snapshot.quote.cryptoCurrency,
    }, async (prepared) => {
      preparedVersion = await this.persistPreparedAttempt({
        evidence: context.evidence,
        expectedVersion: params.expectedVersion,
        initiatedByOpsUserId: params.initiatedByOpsUserId,
        mutationIdempotencyKey: params.mutationIdempotencyKey,
        prepared,
        snapshot,
      })
    })

    if (preparedVersion === null) {
      throw new OpsRefundRecoveryConflictError('The refund attempt was not durably prepared')
    }

    if (sendResult.outcome === 'confirmed') {
      const submittedSnapshot = await this.loadSnapshot(params.transactionId)
      const submittedAttempt = this.attemptByHash(submittedSnapshot, sendResult.transactionId)
      return this.persistReconciliation({
        expectedVersion: preparedVersion,
        originalEvidence: this.requireRefundEvidence(submittedSnapshot),
        originalHash: context.originalHash,
        originalHashExpiresAt: context.originalHashExpiresAt,
        resolutions: [{
          candidate: {
            attemptId: submittedAttempt ? submittedAttempt.id : null,
            expiresAt: submittedAttempt ? submittedAttempt.expiresAt : new Date(),
            hash: sendResult.transactionId,
            status: RefundRecoveryAttemptStatus.PREPARED,
          },
          failureCode: null,
          outcome: 'confirmed',
        }],
        snapshot: submittedSnapshot,
      })
    }

    await this.markPreparedAttemptAmbiguous({
      expectedVersion: preparedVersion,
      failureCode: sendResult.reason,
      transactionHash: sendResult.transactionId,
      transactionId: params.transactionId,
    })
    this.logger.warn('Replacement refund submission remains ambiguous', {
      failureCode: sendResult.reason,
      transactionHashSuffix: sendResult.transactionId.slice(-8),
      transactionId: params.transactionId,
    })
    return this.toDto(await this.loadSnapshot(params.transactionId))
  }

  private async loadSnapshot(transactionId: string, client?: DatabaseClient): Promise<RecoverySnapshot> {
    const database = client ?? await this.databaseClientProvider.getClient()
    const transaction = await database.transaction.findUnique({
      select: recoverySnapshotSelect,
      where: { id: transactionId },
    })
    if (!transaction) throw new OpsRefundRecoveryNotFoundError()
    return transaction
  }

  private async markPreparedAttemptAmbiguous(params: {
    expectedVersion: number
    failureCode: string
    transactionHash: string
    transactionId: string
  }): Promise<void> {
    const client = await this.databaseClientProvider.getClient()
    await client.$transaction(async (transaction) => {
      const recovery = await transaction.refundRecovery.findUnique({
        where: { transactionId: params.transactionId },
      })
      if (!recovery || recovery.version !== params.expectedVersion) {
        throw new OpsRefundRecoveryConflictError()
      }
      const updated = await transaction.refundRecovery.updateMany({
        data: {
          lastFailureCode: params.failureCode,
          lastReconciledAt: new Date(),
          lastResult: RefundReconciliationResult.AMBIGUOUS,
          status: RefundRecoveryStatus.AMBIGUOUS,
          version: { increment: 1 },
        },
        where: { id: recovery.id, version: params.expectedVersion },
      })
      if (updated.count !== 1) throw new OpsRefundRecoveryConflictError()
      await transaction.refundRecoveryAttempt.updateMany({
        data: {
          failureCode: params.failureCode,
          lastReconciledAt: new Date(),
          status: RefundRecoveryAttemptStatus.AMBIGUOUS,
          submittedAt: new Date(),
        },
        where: { recoveryId: recovery.id, transactionHash: params.transactionHash },
      })
    })
  }

  private async persistPreparedAttempt(params: {
    evidence: RefundTransitionEvidence
    expectedVersion: number
    initiatedByOpsUserId: string
    mutationIdempotencyKey: string
    prepared: WalletPreparedSend
    snapshot: RecoverySnapshot
  }): Promise<number> {
    const client = await this.databaseClientProvider.getClient()
    return client.$transaction(async (transaction) => {
      const live = await this.loadSnapshot(params.snapshot.id, transaction)
      this.assertVersion(live, params.expectedVersion)
      this.assertLiveEvidence(live, params.evidence)
      if (live.refundOnChainId) throw new OpsRefundRecoveryConflictError('The refund is already complete')
      const recovery = live.refundRecovery
      if (!recovery || recovery.status !== RefundRecoveryStatus.ELIGIBLE) {
        throw new OpsRefundRecoveryConflictError()
      }

      const reservation = await this.repository.reserveRefund(transaction, {
        idempotencyKey: params.evidence.idempotencyKey,
        reason: params.evidence.reason ?? 'ops_recovery',
        transactionId: params.snapshot.id,
        trigger: 'ops_refund_recovery',
      })
      if (reservation.outcome !== 'reserved') {
        throw new OpsRefundRecoveryConflictError('Another refund operation is already in flight')
      }

      const latestAttempt = recovery.attempts.at(-1)
      const attemptNumber = latestAttempt ? latestAttempt.attemptNumber + 1 : 1
      await transaction.refundRecoveryAttempt.create({
        data: {
          amount: new Prisma.Decimal(params.prepared.amount),
          asset: params.snapshot.quote.cryptoCurrency,
          attemptNumber,
          expiresAt: params.prepared.expiresAt,
          initiatedByOpsUserId: params.initiatedByOpsUserId,
          network: params.snapshot.quote.network,
          operationKey: `ops:refund-recovery:${params.snapshot.id}:${params.mutationIdempotencyKey}`,
          recoveryId: recovery.id,
          signedEnvelopeXdr: params.prepared.signedEnvelopeXdr,
          transactionHash: params.prepared.transactionId,
        },
      })
      const updated = await transaction.refundRecovery.updateMany({
        data: {
          lastFailureCode: null,
          lastResult: null,
          status: RefundRecoveryStatus.IN_FLIGHT,
          version: { increment: 1 },
        },
        where: { id: recovery.id, version: params.expectedVersion },
      })
      if (updated.count !== 1) throw new OpsRefundRecoveryConflictError()
      return params.expectedVersion + 1
    })
  }

  private async persistReconciliation(params: {
    expectedVersion: number
    originalEvidence: RefundTransitionEvidence
    originalHash: string
    originalHashExpiresAt: Date
    resolutions: CandidateResolution[]
    snapshot: RecoverySnapshot
  }): Promise<OpsRefundRecoveryDto> {
    const confirmed = params.resolutions.find(item => item.outcome === 'confirmed')
    const ambiguous = params.resolutions.find(item => item.outcome === 'ambiguous')
    const lastResult = confirmed
      ? RefundReconciliationResult.CONFIRMED
      : ambiguous
        ? RefundReconciliationResult.AMBIGUOUS
        : RefundReconciliationResult.ABSENT
    const status = confirmed
      ? RefundRecoveryStatus.COMPLETED
      : ambiguous
        ? RefundRecoveryStatus.AMBIGUOUS
        : RefundRecoveryStatus.ELIGIBLE
    const now = new Date()
    const client = await this.databaseClientProvider.getClient()
    const webhookTargets = confirmed
      ? await this.transactionWebhookRouter.resolveTargets(
          params.snapshot.partnerUser.partner.webhookUrl,
          params.snapshot.origin,
        )
      : []

    try {
      await client.$transaction(async (transaction) => {
        const live = await this.loadSnapshot(params.snapshot.id, transaction)
        this.assertVersion(live, params.expectedVersion)
        this.assertLiveEvidence(live, params.originalEvidence)
        if (live.refundOnChainId && !confirmed) return

        const recoveryId = await this.upsertRecoveryState(transaction, {
          expectedVersion: params.expectedVersion,
          failureCode: ambiguous ? ambiguous.failureCode : null,
          lastResult,
          originalHash: params.originalHash,
          originalHashExpiresAt: params.originalHashExpiresAt,
          snapshot: live,
          status,
        })
        await this.updateAttemptResolutions(transaction, recoveryId, params.resolutions, now)

        if (confirmed && !live.refundOnChainId) {
          await this.completeRecovery(transaction, {
            evidence: params.originalEvidence,
            refundHash: confirmed.candidate.hash,
            snapshot: live,
            webhookTargets,
          })
        }
        else if (!ambiguous && params.originalEvidence.status === 'pending') {
          await this.repository.recordRefundOutcome(transaction, {
            idempotencyKey: params.originalEvidence.idempotencyKey,
            refundResult: { reason: 'recovery_attempt_absent', success: false },
            transactionId: live.id,
          })
        }
      })
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new OpsRefundRecoveryConflictError()
      }
      throw error
    }

    return this.toDto(await this.loadSnapshot(params.snapshot.id))
  }

  private recoveryWallet(snapshot: RecoverySnapshot): RecoveryWallet {
    const handler = this.walletHandlerFactory.getWalletHandlerForCapability
      ? this.walletHandlerFactory.getWalletHandlerForCapability({ blockchain: snapshot.quote.network })
      : this.walletHandlerFactory.getWalletHandler(snapshot.quote.network)
    if (!supportsRecovery(handler)) {
      throw new OpsRefundRecoveryValidationError('Refund recovery is not supported for this network')
    }
    return handler
  }

  private refundAmount(
    snapshot: RecoverySnapshot,
    evidence: null | RefundTransitionEvidence,
  ): null | number {
    return resolveRefundAmount({
      quoteSourceAmount: snapshot.quote.sourceAmount,
      refundEvidence: evidence,
      status: snapshot.status,
      transitions: snapshot.transitions,
    })
  }

  private refundEvidence(snapshot: RecoverySnapshot): null | RefundTransitionEvidence {
    return parseRefundTransition(snapshot.transitions.find(transition => transition.event === 'refund'))
  }

  private requireRefundEvidence(snapshot: RecoverySnapshot): RefundTransitionEvidence {
    const evidence = this.refundEvidence(snapshot)
    if (!evidence) throw new OpsRefundRecoveryConflictError()
    return evidence
  }

  private async resolveCandidates(
    wallet: RecoveryWallet,
    candidates: readonly RecoveryCandidate[],
    forceLookup: boolean,
  ): Promise<CandidateResolution[]> {
    const now = Date.now()
    return Promise.all(candidates.map(async (candidate): Promise<CandidateResolution> => {
      if (!forceLookup && candidate.status === RefundRecoveryAttemptStatus.CONFIRMED) {
        return { candidate, failureCode: null, outcome: 'confirmed' }
      }
      if (!forceLookup && candidate.status === RefundRecoveryAttemptStatus.ABSENT) {
        return { candidate, failureCode: null, outcome: 'absent' }
      }

      const result: WalletTransactionReconciliationResult = await wallet.reconcileTransaction(candidate.hash)
      if (result.outcome === 'confirmed') {
        return { candidate, failureCode: null, outcome: 'confirmed' }
      }
      if (result.outcome === 'failed') {
        return { candidate, failureCode: 'stellar_transaction_failed', outcome: 'absent' }
      }
      if (result.outcome === 'unavailable') {
        return { candidate, failureCode: result.reason, outcome: 'ambiguous' }
      }

      const isDefinitivelyExpired = now >= candidate.expiresAt.getTime() + ABSENCE_CLOCK_SKEW_MS
      return isDefinitivelyExpired
        ? { candidate, failureCode: null, outcome: 'absent' }
        : { candidate, failureCode: 'stellar_finality_pending', outcome: 'ambiguous' }
    }))
  }

  private status(snapshot: RecoverySnapshot, evidence: null | RefundTransitionEvidence): OpsRefundRecoveryPosture {
    if (snapshot.refundOnChainId) return 'COMPLETED'
    if (!refundRelevantStatuses.has(snapshot.status) && !evidence) return 'NOT_REQUIRED'
    if (snapshot.quote.network !== BlockchainNetwork.STELLAR) return 'UNSUPPORTED'
    if (this.blockReason(snapshot, evidence)) return 'BLOCKED'
    return snapshot.refundRecovery ? snapshot.refundRecovery.status : 'NEEDS_RECONCILIATION'
  }

  private toDto(snapshot: RecoverySnapshot): OpsRefundRecoveryDto {
    const evidence = this.refundEvidence(snapshot)
    const status = this.status(snapshot, evidence)
    const recovery = snapshot.refundRecovery
    const latestAttempt = recovery ? recovery.attempts.at(-1) : undefined
    const persistedOriginalHash = recovery ? recovery.originalRefundHash : null
    const candidateHash = latestAttempt
      ? latestAttempt.transactionHash
      : persistedOriginalHash || (evidence ? evidence.candidateHash : null)
    const evidenceAttempts = evidence ? evidence.attempts : 0
    const recoveryAttempts = recovery ? recovery.attempts.length : 0
    const lastReconciliation = recovery && recovery.lastReconciledAt && recovery.lastResult
      ? { at: recovery.lastReconciledAt, result: recovery.lastResult }
      : null
    return {
      amount: this.refundAmount(snapshot, evidence),
      asset: snapshot.quote.cryptoCurrency,
      attempts: Math.max(evidenceAttempts, recoveryAttempts),
      blockReason: status === 'BLOCKED' || status === 'UNSUPPORTED'
        ? this.blockReason(snapshot, evidence)
        : null,
      candidateHashFingerprint: refundHashFingerprint(candidateHash),
      canonicalRefundRecorded: Boolean(snapshot.refundOnChainId),
      lastFailureCategory: this.failureCategory(snapshot, evidence),
      lastReconciliation,
      network: snapshot.quote.network,
      replacementEligible: status === 'ELIGIBLE',
      status,
      transactionId: snapshot.id,
      version: recovery ? recovery.version : 1,
    }
  }

  private async updateAttemptResolutions(
    transaction: Prisma.TransactionClient,
    recoveryId: string,
    resolutions: readonly CandidateResolution[],
    reconciledAt: Date,
  ): Promise<void> {
    for (const resolution of resolutions) {
      if (!resolution.candidate.attemptId) continue
      const status = resolution.outcome === 'confirmed'
        ? RefundRecoveryAttemptStatus.CONFIRMED
        : resolution.outcome === 'absent'
          ? RefundRecoveryAttemptStatus.ABSENT
          : RefundRecoveryAttemptStatus.AMBIGUOUS
      await transaction.refundRecoveryAttempt.updateMany({
        data: {
          completedAt: resolution.outcome === 'confirmed' ? reconciledAt : undefined,
          failureCode: resolution.failureCode,
          lastReconciledAt: reconciledAt,
          status,
          submittedAt: resolution.outcome === 'confirmed' ? reconciledAt : undefined,
        },
        where: { id: resolution.candidate.attemptId, recoveryId },
      })
    }
  }

  private async upsertRecoveryState(
    transaction: Prisma.TransactionClient,
    params: {
      expectedVersion: number
      failureCode: null | string
      lastResult: RefundReconciliationResult
      originalHash: string
      originalHashExpiresAt: Date
      snapshot: RecoverySnapshot
      status: RefundRecoveryStatus
    },
  ): Promise<string> {
    const existing = params.snapshot.refundRecovery
    if (!existing) {
      if (params.expectedVersion !== 1) throw new OpsRefundRecoveryConflictError()
      const created = await transaction.refundRecovery.create({
        data: {
          lastFailureCode: params.failureCode,
          lastReconciledAt: new Date(),
          lastResult: params.lastResult,
          originalHashExpiresAt: params.originalHashExpiresAt,
          originalRefundHash: params.originalHash,
          status: params.status,
          transactionId: params.snapshot.id,
          version: 2,
        },
      })
      return created.id
    }

    if (existing.originalRefundHash && existing.originalRefundHash !== params.originalHash) {
      throw new OpsRefundRecoveryConflictError('The original refund hash changed')
    }
    const updated = await transaction.refundRecovery.updateMany({
      data: {
        lastFailureCode: params.failureCode,
        lastReconciledAt: new Date(),
        lastResult: params.lastResult,
        originalHashExpiresAt: existing.originalHashExpiresAt ?? params.originalHashExpiresAt,
        originalRefundHash: existing.originalRefundHash ?? params.originalHash,
        status: params.status,
        version: { increment: 1 },
      },
      where: { id: existing.id, version: params.expectedVersion },
    })
    if (updated.count !== 1) throw new OpsRefundRecoveryConflictError()
    return existing.id
  }
}
