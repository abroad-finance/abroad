import { TransactionStatus } from '@prisma/client'

import { TransferoPayoutStatusAdapter } from '../../../../modules/payments/infrastructure/TransferoPayoutStatusAdapter'

describe('TransferoPayoutStatusAdapter', () => {
  const adapter = new TransferoPayoutStatusAdapter()

  it('maps Ultra terminal failure statuses to payment failed', () => {
    for (const status of ['CANCELLED', 'FAILED', 'REJECTED', 'RETURNED']) {
      expect(adapter.mapStatus(status)).toBe(TransactionStatus.PAYMENT_FAILED)
    }
  })

  it('maps only SETTLED to payment completed', () => {
    expect(adapter.mapStatus('SETTLED')).toBe(TransactionStatus.PAYMENT_COMPLETED)
  })

  it('maps every Ultra in-flight status to processing', () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED', 'PENDING', 'PROCESSING']) {
      expect(adapter.mapStatus(status)).toBe(TransactionStatus.PROCESSING_PAYMENT)
    }
  })

  it('does not treat legacy substring statuses as terminal success or failure', () => {
    for (const status of ['processed', 'payment error', 'Queued for processing', 'unknown-state']) {
      expect(adapter.mapStatus(status)).toBe(TransactionStatus.PROCESSING_PAYMENT)
    }
  })
})
