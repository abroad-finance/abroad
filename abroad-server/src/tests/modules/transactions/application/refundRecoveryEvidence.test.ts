import { TransactionStatus } from '@prisma/client'

import { parseRefundTransition, refundHashFingerprint, resolveRefundAmount } from '../../../../modules/transactions/application/refundRecoveryEvidence'

const candidateHash = 'a'.repeat(64)

describe('refundRecoveryEvidence', () => {
  it('extracts the durable candidate hash and classifies a timeout without exposing raw failure data', () => {
    const evidence = parseRefundTransition({
      context: {
        attempts: 1,
        candidateTransactionId: candidateHash,
        lastError: 'stellar_submission_timeout',
        reason: 'provider_failed',
        status: 'failed',
      },
      createdAt: new Date('2026-08-03T12:00:00.000Z'),
      event: 'refund',
      idempotencyKey: 'flow:refund:tx-1:provider_failed',
    })

    expect(evidence).toEqual(expect.objectContaining({
      attempts: 1,
      candidateHash,
      failureCategory: 'NETWORK_TIMEOUT',
      reason: 'provider_failed',
      status: 'failed',
    }))
    expect(refundHashFingerprint(evidence?.candidateHash ?? null)).toBe('••••aaaaaaaa')
  })

  it('recovers the hash from historical Horizon failure JSON', () => {
    const evidence = parseRefundTransition({
      context: {
        attempts: 1,
        lastError: JSON.stringify({ extras: { envelope_xdr: 'never-return-this', hash: candidateHash }, status: 504 }),
        reason: 'provider_failed',
        status: 'failed',
      },
      createdAt: new Date('2026-08-03T12:00:00.000Z'),
      event: 'refund',
      idempotencyKey: 'flow:refund:tx-1:provider_failed',
    })

    expect(evidence?.candidateHash).toBe(candidateHash)
    expect(evidence?.failureCategory).toBe('NETWORK_TIMEOUT')
    expect(JSON.stringify(evidence)).not.toContain('envelope_xdr')
  })

  it('uses the received amount for wrong-amount refunds and blocks unknown expired amounts', () => {
    const wrongAmountEvidence = parseRefundTransition({
      context: { attempts: 1, candidateTransactionId: candidateHash, reason: 'wrong_amount', status: 'failed' },
      createdAt: new Date(),
      event: 'refund',
      idempotencyKey: 'wrong-amount-refund',
    })
    const transitions = [{
      context: { expectedAmount: 5, receivedAmount: 4.25 },
      createdAt: new Date(),
      event: 'wrong_amount',
      idempotencyKey: 'wrong-amount',
    }]
    expect(resolveRefundAmount({
      quoteSourceAmount: 5,
      refundEvidence: wrongAmountEvidence,
      status: TransactionStatus.WRONG_AMOUNT,
      transitions,
    })).toBe(4.25)

    const expiredEvidence = parseRefundTransition({
      context: { attempts: 1, candidateTransactionId: candidateHash, reason: 'expired_transaction', status: 'failed' },
      createdAt: new Date(),
      event: 'refund',
      idempotencyKey: 'expired-refund',
    })
    expect(resolveRefundAmount({
      quoteSourceAmount: 5,
      refundEvidence: expiredEvidence,
      status: TransactionStatus.PAYMENT_EXPIRED,
      transitions: [],
    })).toBeNull()
  })
})
