import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  RefundReconciliationResult,
  RefundRecoveryAttemptStatus,
  RefundRecoveryStatus,
  TransactionOrigin,
  TransactionStatus,
} from '@prisma/client'

import type { IWalletHandler } from '../../../../modules/payments/application/contracts/IWalletHandler'
import type { IWalletHandlerFactory } from '../../../../modules/payments/application/contracts/IWalletHandlerFactory'

import { OpsRefundRecoveryConflictError, OpsRefundRecoveryService } from '../../../../modules/transactions/application/OpsRefundRecoveryService'
import { TransactionRepository } from '../../../../modules/transactions/application/TransactionRepository'
import { createMockLogger } from '../../../setup/mockFactories'

const originalHash = 'a'.repeat(64)
const replacementHash = 'b'.repeat(64)

const refundTransition = {
  context: {
    attempts: 1,
    candidateTransactionId: originalHash,
    lastError: 'stellar_submission_timeout',
    reason: 'provider_failed',
    status: 'failed',
    trigger: 'flow_provider_status',
  },
  createdAt: new Date('2026-07-28T01:08:02.000Z'),
  event: 'refund',
  idempotencyKey: 'flow:refund:tx-1:provider_failed',
}

const baseSnapshot = {
  id: 'tx-1',
  onChainId: 'deposit-hash',
  origin: TransactionOrigin.DIRECT,
  partnerUser: { partner: { id: 'partner-1', webhookUrl: 'https://partner.example/webhook' } },
  quote: {
    cryptoCurrency: CryptoCurrency.USDC,
    network: BlockchainNetwork.STELLAR,
    sourceAmount: 5.99,
  },
  refundOnChainId: null,
  refundRecovery: null,
  status: TransactionStatus.PAYMENT_FAILED,
  transitions: [refundTransition],
}

const recoveryRecord = (overrides: Record<string, unknown> = {}) => ({
  attempts: [],
  createdAt: new Date('2026-08-03T12:00:00.000Z'),
  id: 'recovery-1',
  lastFailureCode: null,
  lastReconciledAt: new Date('2026-08-03T12:00:00.000Z'),
  lastResult: RefundReconciliationResult.ABSENT,
  originalHashExpiresAt: new Date('2026-07-28T01:10:02.000Z'),
  originalRefundHash: originalHash,
  status: RefundRecoveryStatus.ELIGIBLE,
  transactionId: 'tx-1',
  updatedAt: new Date('2026-08-03T12:00:00.000Z'),
  version: 2,
  ...overrides,
})

type Harness = {
  attemptCreate: jest.Mock
  client: {
    $transaction: jest.Mock
    transaction: { findUnique: jest.Mock }
  }
  innerFindUnique: jest.Mock
  recoveryCreate: jest.Mock
  recoveryFindUnique: jest.Mock
  recoveryUpdateMany: jest.Mock
  router: {
    enqueueTargets: jest.Mock
    resolveTargets: jest.Mock
  }
  service: OpsRefundRecoveryService
  wallet: IWalletHandler & {
    getAddressFromTransaction: jest.Mock
    reconcileTransaction: jest.Mock
    sendDurably: jest.Mock
  }
}

const buildHarness = (outerSnapshots: readonly unknown[]): Harness => {
  const outerFindUnique = jest.fn()
  for (const snapshot of outerSnapshots) outerFindUnique.mockResolvedValueOnce(snapshot)
  const innerFindUnique = jest.fn(async () => baseSnapshot)
  const recoveryCreate = jest.fn(async () => ({ id: 'recovery-1' }))
  const recoveryFindUnique = jest.fn()
  const recoveryUpdateMany = jest.fn(async () => ({ count: 1 }))
  const attemptCreate = jest.fn(async () => ({ id: 'attempt-1' }))
  const transaction = {
    refundRecovery: {
      create: recoveryCreate,
      findUnique: recoveryFindUnique,
      updateMany: recoveryUpdateMany,
    },
    refundRecoveryAttempt: {
      create: attemptCreate,
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    transaction: { findUnique: innerFindUnique },
  }
  const client = {
    $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
    transaction: { findUnique: outerFindUnique },
  }
  const wallet = {
    getAddressFromTransaction: jest.fn(async () => 'verified-sender'),
    reconcileTransaction: jest.fn(async () => ({ outcome: 'absent' as const })),
    send: jest.fn(),
    sendDurably: jest.fn(),
  }
  const walletFactory = {
    getWalletHandler: jest.fn(() => wallet),
    getWalletHandlerForCapability: jest.fn(() => wallet),
  } as unknown as IWalletHandlerFactory
  const lockManager = {
    withLock: jest.fn(async (_key: string, _timeout: number, operation: () => Promise<unknown>) => operation()),
  }
  const router = {
    enqueueTargets: jest.fn(async () => undefined),
    resolveTargets: jest.fn(async () => ['https://partner.example/webhook']),
  }
  const service = new OpsRefundRecoveryService(
    { getClient: jest.fn(async () => client) } as never,
    walletFactory,
    lockManager as never,
    router as never,
    createMockLogger(),
  )
  return {
    attemptCreate,
    client,
    innerFindUnique,
    recoveryCreate,
    recoveryFindUnique,
    recoveryUpdateMany,
    router,
    service,
    wallet,
  }
}

describe('OpsRefundRecoveryService', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('proves an expired original hash absent and makes replacement eligible', async () => {
    const eligibleSnapshot = { ...baseSnapshot, refundRecovery: recoveryRecord() }
    const harness = buildHarness([baseSnapshot, eligibleSnapshot])

    const result = await harness.service.reconcile({ expectedVersion: 1, transactionId: 'tx-1' })

    expect(harness.wallet.reconcileTransaction).toHaveBeenCalledWith(originalHash)
    expect(harness.recoveryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalRefundHash: originalHash,
        status: RefundRecoveryStatus.ELIGIBLE,
        transactionId: 'tx-1',
        version: 2,
      }),
    })
    expect(result).toEqual(expect.objectContaining({
      replacementEligible: true,
      status: 'ELIGIBLE',
      version: 2,
    }))
  })

  it('records a confirmed original hash and enqueues one durable partner update', async () => {
    const completedSnapshot = {
      ...baseSnapshot,
      refundOnChainId: originalHash,
      refundRecovery: recoveryRecord({
        lastResult: RefundReconciliationResult.CONFIRMED,
        status: RefundRecoveryStatus.COMPLETED,
      }),
    }
    const harness = buildHarness([baseSnapshot, completedSnapshot])
    harness.wallet.reconcileTransaction.mockResolvedValue({ outcome: 'confirmed', transactionId: originalHash })
    const recordOutcome = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
    harness.innerFindUnique.mockImplementation(async (args: unknown) => (
      args && typeof args === 'object' && 'include' in args
        ? { ...baseSnapshot, accountNumber: 'redacted', bankCode: '' }
        : baseSnapshot
    ))

    const result = await harness.service.reconcile({ expectedVersion: 1, transactionId: 'tx-1' })

    expect(recordOutcome).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      refundResult: { success: true, transactionId: originalHash },
      transactionId: 'tx-1',
    }))
    expect(harness.router.enqueueTargets).toHaveBeenCalledWith(
      ['https://partner.example/webhook'],
      expect.objectContaining({ event: 'transaction.updated' }),
      'ops_refund_recovery',
      expect.objectContaining({
        deliverNow: false,
        idempotencyKey: `refund-recovery:completed:tx-1:${originalHash}`,
      }),
    )
    expect(result.status).toBe('COMPLETED')
  })

  it('persists a signed replacement before broadcast and leaves an ambiguous result blocked', async () => {
    const eligibleSnapshot = { ...baseSnapshot, refundRecovery: recoveryRecord() }
    const ambiguousAttempt = {
      amount: 5.99,
      asset: CryptoCurrency.USDC,
      attemptNumber: 1,
      completedAt: null,
      expiresAt: new Date('2099-08-03T12:00:30.000Z'),
      failureCode: 'stellar_submission_timeout',
      id: 'attempt-1',
      initiatedByOpsUserId: 'ops-user-1',
      lastReconciledAt: new Date('2026-08-03T12:01:00.000Z'),
      network: BlockchainNetwork.STELLAR,
      operationKey: 'operation-1',
      preparedAt: new Date('2026-08-03T12:00:00.000Z'),
      recoveryId: 'recovery-1',
      signedEnvelopeXdr: 'stored-but-never-returned',
      status: RefundRecoveryAttemptStatus.AMBIGUOUS,
      submittedAt: new Date('2026-08-03T12:00:00.000Z'),
      transactionHash: replacementHash,
    }
    const ambiguousSnapshot = {
      ...baseSnapshot,
      refundRecovery: recoveryRecord({
        attempts: [ambiguousAttempt],
        lastFailureCode: 'stellar_submission_timeout',
        lastResult: RefundReconciliationResult.AMBIGUOUS,
        status: RefundRecoveryStatus.AMBIGUOUS,
        version: 4,
      }),
      transitions: [{ ...refundTransition, context: { ...refundTransition.context, attempts: 2, status: 'pending' } }],
    }
    const harness = buildHarness([eligibleSnapshot, ambiguousSnapshot])
    harness.innerFindUnique.mockResolvedValue(eligibleSnapshot)
    harness.recoveryFindUnique.mockResolvedValue({ id: 'recovery-1', version: 3 })
    jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 2, outcome: 'reserved' })
    harness.wallet.sendDurably.mockImplementation(async (_params, persistPrepared) => {
      await persistPrepared({
        amount: '5.99',
        expiresAt: new Date('2099-08-03T12:00:30.000Z'),
        signedEnvelopeXdr: 'signed-envelope-xdr',
        transactionId: replacementHash,
      })
      expect(harness.attemptCreate).toHaveBeenCalledTimes(1)
      return { outcome: 'ambiguous', reason: 'stellar_submission_timeout', transactionId: replacementHash }
    })

    const result = await harness.service.issueReplacement({
      expectedVersion: 2,
      initiatedByOpsUserId: 'ops-user-1',
      mutationIdempotencyKey: 'e5083f1f-3500-4888-b9c3-5d9bd38b6749',
      transactionId: 'tx-1',
    })

    expect(harness.wallet.getAddressFromTransaction).toHaveBeenCalledWith({ onChainId: 'deposit-hash' })
    expect(harness.attemptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        initiatedByOpsUserId: 'ops-user-1',
        signedEnvelopeXdr: 'signed-envelope-xdr',
        transactionHash: replacementHash,
      }),
    })
    expect(result).toEqual(expect.objectContaining({
      replacementEligible: false,
      status: 'AMBIGUOUS',
      version: 4,
    }))
    expect(JSON.stringify(result)).not.toContain('signed-envelope-xdr')
  })

  it('marks an expired prepared attempt failed before allowing another replacement', async () => {
    const attempt = {
      attemptNumber: 1,
      expiresAt: new Date('2026-08-03T12:00:30.000Z'),
      id: 'attempt-1',
      status: RefundRecoveryAttemptStatus.AMBIGUOUS,
      transactionHash: replacementHash,
    }
    const pendingTransition = {
      ...refundTransition,
      context: { ...refundTransition.context, attempts: 2, status: 'pending' },
    }
    const ambiguousSnapshot = {
      ...baseSnapshot,
      refundRecovery: recoveryRecord({
        attempts: [attempt],
        lastResult: RefundReconciliationResult.AMBIGUOUS,
        status: RefundRecoveryStatus.AMBIGUOUS,
        version: 4,
      }),
      transitions: [pendingTransition],
    }
    const eligibleSnapshot = {
      ...ambiguousSnapshot,
      refundRecovery: recoveryRecord({
        attempts: [{ ...attempt, status: RefundRecoveryAttemptStatus.ABSENT }],
        lastResult: RefundReconciliationResult.ABSENT,
        status: RefundRecoveryStatus.ELIGIBLE,
        version: 5,
      }),
      transitions: [{ ...pendingTransition, context: { ...pendingTransition.context, status: 'failed' } }],
    }
    const harness = buildHarness([ambiguousSnapshot, eligibleSnapshot])
    harness.innerFindUnique.mockResolvedValue(ambiguousSnapshot)
    const recordOutcome = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)

    const result = await harness.service.reconcile({ expectedVersion: 4, transactionId: 'tx-1' })

    expect(harness.wallet.reconcileTransaction).toHaveBeenCalledTimes(2)
    expect(recordOutcome).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: refundTransition.idempotencyKey,
      refundResult: { reason: 'recovery_attempt_absent', success: false },
      transactionId: 'tx-1',
    })
    expect(result.replacementEligible).toBe(true)
  })

  it('rejects stale recovery evidence before any chain call or submission', async () => {
    const harness = buildHarness([{ ...baseSnapshot, refundRecovery: recoveryRecord({ version: 3 }) }])

    await expect(harness.service.reconcile({ expectedVersion: 2, transactionId: 'tx-1' }))
      .rejects.toBeInstanceOf(OpsRefundRecoveryConflictError)
    expect(harness.wallet.reconcileTransaction).not.toHaveBeenCalled()
    expect(harness.wallet.sendDurably).not.toHaveBeenCalled()
  })
})
