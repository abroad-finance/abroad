import { TransactionStatus } from '@prisma/client'

import { BrebPayoutStatusAdapter } from '../../../../../modules/payments/infrastructure/BrebPayoutStatusAdapter'

describe('BrebPayoutStatusAdapter', () => {
  const adapter = new BrebPayoutStatusAdapter()

  it('maps acceptance codes to payment completed', () => {
    expect(adapter.mapStatus('ACCP')).toBe(TransactionStatus.PAYMENT_COMPLETED)
    expect(adapter.mapStatus('acsc')).toBe(TransactionStatus.PAYMENT_COMPLETED)
    expect(adapter.mapStatus('processed')).toBe(TransactionStatus.PAYMENT_COMPLETED)
  })

  it('maps rejection/cancel codes to payment failed', () => {
    expect(adapter.mapStatus('RJCT')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(adapter.mapStatus('canc')).toBe(TransactionStatus.PAYMENT_FAILED)
    expect(adapter.mapStatus('failed')).toBe(TransactionStatus.PAYMENT_FAILED)
  })

  it('maps pending/unknown statuses to processing', () => {
    expect(adapter.mapStatus('PDNG')).toBe(TransactionStatus.PROCESSING_PAYMENT)
    expect(adapter.mapStatus('unknown-status')).toBe(TransactionStatus.PROCESSING_PAYMENT)
  })
})
