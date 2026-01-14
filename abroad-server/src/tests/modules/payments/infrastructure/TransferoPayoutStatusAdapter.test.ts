import { TransactionStatus } from '@prisma/client'

import { TransferoPayoutStatusAdapter } from '../../../../modules/payments/infrastructure/TransferoPayoutStatusAdapter'

describe('TransferoPayoutStatusAdapter', () => {
  const adapter = new TransferoPayoutStatusAdapter()

  it('maps error-oriented statuses to payment failed', () => {
    expect(adapter.mapStatus('Canceled')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(adapter.mapStatus('payment error')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(adapter.mapStatus('rejected')).toBe(TransactionStatus.PAYMENT_FAILED)
  })

  it('maps success statuses to payment completed', () => {
    expect(adapter.mapStatus('processed')).toBe(TransactionStatus.PAYMENT_COMPLETED)
    expect(adapter.mapStatus('SETTLED')).toBe(TransactionStatus.PAYMENT_COMPLETED)
  })

  it('maps in-flight statuses to processing', () => {
    expect(adapter.mapStatus('pending')).toBe(TransactionStatus.PROCESSING_PAYMENT)
    expect(adapter.mapStatus('Queued for processing')).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })

  it('falls back to processing for unrecognized statuses', () => {
    expect(adapter.mapStatus('unknown-state')).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })
})
